import { audioBus } from './audioBus.ts';
import { liveVoice } from '../speech/liveVoice.ts';
import type { SfxName } from '../game/engine.ts';
import type { ClipRef } from '../game/types.ts';

/** Sound effect catalog. Files are rendered by scripts/generate-sfx.py. */
const SFX_FILES: Record<SfxName, string> = {
  correct: 'correct',
  wrong: 'wrong',
  timeout: 'timeout',
  'lock-in': 'lock-in',
  'buzz-in': 'buzz-in',
  tick: 'tick',
  'timer-warning': 'timer-warning',
  'reveal-drumroll': 'reveal-drumroll',
  applause: 'applause',
  fanfare: 'fanfare',
  'intro-sting': 'intro-sting',
  'theme-set': 'theme-set',
  'player-join': 'player-join',
  'game-start': 'game-start',
  'clip-whoosh': 'clip-whoosh',
  transition: 'transition',
  streak: 'streak',
  scoreboard: 'scoreboard',
  click: 'click_001',
};

const SFX_GAIN: Partial<Record<SfxName, number>> = {
  tick: 0.35,
  'timer-warning': 0.6,
  applause: 0.55,
  fanfare: 0.7,
  'intro-sting': 0.6,
  'game-start': 0.65,
  click: 0.4,
};

const MUSIC_VOLUME = 0.14;
const MUSIC_DUCKED_VOLUME = 0.025;

function sfxUrl(name: SfxName) {
  const file = SFX_FILES[name];
  if (file === 'click_001') return '/audio/sfx/click_001.ogg';
  const probe = typeof Audio !== 'undefined' ? new Audio() : null;
  const canOgg = probe ? probe.canPlayType('audio/ogg; codecs="vorbis"') !== '' : true;
  return `/audio/sfx/${file}.${canOgg ? 'ogg' : 'mp3'}`;
}

export interface ClipPlayback {
  /** Resolves when the excerpt has finished (or failed). */
  done: Promise<'played' | 'failed' | 'stopped'>;
  stop(): void;
}

class MediaEngine {
  private sfxEnabled = true;
  private musicEnabled = true;
  private musicElement: HTMLAudioElement | null = null;
  private musicListeners: Array<(isPlaying: boolean) => void> = [];
  private musicFadeTimer: number | null = null;
  private duckSources = new Set<string>();
  /** While players are expected to speak, music is cut entirely so the mic hears only voices. */
  private listening = false;
  private sfxBuffers = new Map<SfxName, Promise<AudioBuffer | null>>();
  private clipBuffers = new Map<string, Promise<{ buffer: AudioBuffer; clip: ClipRef } | null>>();
  private activeClip: ClipPlayback | null = null;

  // ----------------------------------------------------------------- toggles
  setSfxEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
  }

  getSfxEnabled() {
    return this.sfxEnabled;
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    void this.toggleBackgroundMusic(enabled);
  }

  getMusicEnabled() {
    return this.musicEnabled;
  }

  setMasterMuted(muted: boolean) {
    audioBus.setMuted(muted);
    if (this.musicElement) this.musicElement.muted = muted;
  }

  getMasterMuted() {
    return audioBus.isMuted();
  }

  /** Must be called from a user gesture (or page load where allowed) to unlock audio. */
  async unlock() {
    await audioBus.resume();
  }

  // ------------------------------------------------------------------- music
  getBackgroundMusicStatus() {
    return Boolean(this.musicElement && !this.musicElement.paused);
  }

  subscribeBackgroundMusic(listener: (isPlaying: boolean) => void) {
    this.musicListeners.push(listener);
    listener(this.getBackgroundMusicStatus());
    return () => {
      this.musicListeners = this.musicListeners.filter(existing => existing !== listener);
    };
  }

  private notifyMusic() {
    const playing = this.getBackgroundMusicStatus();
    this.musicListeners.forEach(listener => listener(playing));
  }

  async toggleBackgroundMusic(enabled?: boolean) {
    if (typeof Audio === 'undefined') return;
    const audio = this.musicElement ?? new Audio('/audio/music/game-loop.mp3');
    this.musicElement = audio;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = this.listening ? 0 : this.duckSources.size ? MUSIC_DUCKED_VOLUME : MUSIC_VOLUME;
    audio.muted = audioBus.isMuted();
    audio.onplay = () => this.notifyMusic();
    audio.onpause = () => this.notifyMusic();
    const shouldPlay = enabled ?? audio.paused;
    this.musicEnabled = shouldPlay;
    if (!shouldPlay) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch (error) {
      // Autoplay policies: the header button or any click will retry.
      console.info('Background music is waiting for a user gesture:', (error as Error).message);
    }
  }

  stopBackgroundMusic() {
    this.musicElement?.pause();
    this.notifyMusic();
  }

  /** Cuts the music while the room is being listened to (answers, names, confirmations). */
  setListening(listening: boolean) {
    if (this.listening === listening) return;
    this.listening = listening;
    this.applyMusicVolume();
  }

  /** Lowers the music while a named source (host voice, clip) is audible. */
  duckMusic(source: string, ducked: boolean) {
    if (ducked) this.duckSources.add(source);
    else this.duckSources.delete(source);
    this.applyMusicVolume();
  }

  private applyMusicVolume() {
    const audio = this.musicElement;
    if (!audio) return;
    if (this.musicFadeTimer !== null) window.clearInterval(this.musicFadeTimer);
    const target = this.listening ? 0 : this.duckSources.size ? MUSIC_DUCKED_VOLUME : MUSIC_VOLUME;
    const from = audio.volume;
    const started = performance.now();
    const duration = target < from ? 150 : 1200;
    this.musicFadeTimer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      audio.volume = from + (target - from) * progress;
      if (progress === 1 && this.musicFadeTimer !== null) {
        window.clearInterval(this.musicFadeTimer);
        this.musicFadeTimer = null;
      }
    }, 30);
  }

  // --------------------------------------------------------------------- sfx
  preloadSfx(names: SfxName[] = Object.keys(SFX_FILES) as SfxName[]) {
    names.forEach(name => void this.loadSfx(name));
  }

  private loadSfx(name: SfxName) {
    if (!this.sfxBuffers.has(name)) {
      const loader = (async () => {
        try {
          const response = await fetch(sfxUrl(name));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await audioBus.decode(await response.arrayBuffer());
        } catch (error) {
          console.warn(`Could not load sound effect "${name}":`, error);
          return null;
        }
      })();
      this.sfxBuffers.set(name, loader);
    }
    return this.sfxBuffers.get(name)!;
  }

  async playEffect(name: SfxName) {
    if (!this.sfxEnabled) return;
    const context = await audioBus.resume();
    const bus = audioBus.bus('sfx');
    const buffer = await this.loadSfx(name);
    if (!context || !bus || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = SFX_GAIN[name] ?? 0.8;
    source.connect(gain).connect(bus);
    source.start();
  }

  // ------------------------------------------------------------------- clips
  /** Fetches + decodes an authentic clip, polling while the pipeline is still working. */
  preloadClip(clip: ClipRef | undefined, options: { maxWaitMs?: number } = {}) {
    if (!clip) return Promise.resolve(null);
    const key = clip.id;
    if (!this.clipBuffers.has(key)) {
      const loader = this.fetchClip(clip, options.maxWaitMs ?? 45_000).catch(error => {
        console.warn(`Clip "${clip.id}" unavailable:`, error);
        this.clipBuffers.delete(key);
        return null;
      });
      this.clipBuffers.set(key, loader);
    }
    return this.clipBuffers.get(key)!;
  }

  private async fetchClip(clip: ClipRef, maxWaitMs: number): Promise<{ buffer: AudioBuffer; clip: ClipRef } | null> {
    const url = clip.url ?? `/api/clips/${encodeURIComponent(clip.id)}`;
    const deadline = Date.now() + maxWaitMs;
    let latest: ClipRef = clip;
    while (Date.now() < deadline) {
      const response = await fetch(url, { cache: 'force-cache' });
      if (response.status === 202) {
        latest = { ...latest, ...(await response.json().catch(() => ({}))) };
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      const offset = Number(response.headers.get('X-Clip-Offset') ?? latest.offsetSeconds ?? 0) || 0;
      const duration = Number(response.headers.get('X-Clip-Duration') ?? latest.durationSeconds ?? 0) || undefined;
      const buffer = await audioBus.decode(await response.arrayBuffer());
      if (!buffer) throw new Error('Web Audio unavailable');
      return { buffer, clip: { ...latest, status: 'ready', offsetSeconds: offset, durationSeconds: duration } };
    }
    throw new Error('Clip is still being prepared');
  }

  /** Plays an excerpt; resolves once it ends. The mic is paused and music ducked meanwhile. */
  playClip(clip: ClipRef, maxSeconds: number): ClipPlayback {
    this.stopCurrentClip();
    let stopped = false;
    let source: AudioBufferSourceNode | null = null;
    let resolveDone: (value: 'played' | 'failed' | 'stopped') => void = () => undefined;
    const done = new Promise<'played' | 'failed' | 'stopped'>(resolve => {
      resolveDone = resolve;
    });
    const cleanup = () => {
      liveVoice.setPlaybackSuppressed('clip', false);
      this.duckMusic('clip', false);
      if (this.activeClip === playback) this.activeClip = null;
    };
    const playback: ClipPlayback = {
      done,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source?.stop();
        } catch {
          // already stopped
        }
        cleanup();
        resolveDone('stopped');
      },
    };
    this.activeClip = playback;
    liveVoice.setPlaybackSuppressed('clip', true);
    this.duckMusic('clip', true);

    void (async () => {
      try {
        const context = await audioBus.resume();
        const bus = audioBus.bus('clip');
        const loaded = await this.preloadClip(clip, { maxWaitMs: 20_000 });
        if (stopped) return;
        if (!context || !bus || !loaded) throw new Error('clip unavailable');
        const offset = Math.min(loaded.clip.offsetSeconds ?? 0, Math.max(0, loaded.buffer.duration - 0.5));
        const available = loaded.buffer.duration - offset;
        const duration = Math.max(0.5, Math.min(maxSeconds, loaded.clip.durationSeconds ?? maxSeconds, available));
        source = context.createBufferSource();
        source.buffer = loaded.buffer;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(1, context.currentTime + 0.05);
        gain.gain.setValueAtTime(1, context.currentTime + Math.max(0.05, duration - 0.25));
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
        source.connect(gain).connect(bus);
        source.onended = () => {
          if (stopped) return;
          stopped = true;
          cleanup();
          resolveDone('played');
        };
        source.start(0, offset, duration);
      } catch (error) {
        if (stopped) return;
        stopped = true;
        console.warn('Could not play clip:', error);
        cleanup();
        resolveDone('failed');
      }
    })();
    return playback;
  }

  /** Plays base64 audio (WAV/MP3 from the TTS endpoints) on the clip bus. */
  playEncodedAudio(base64: string, bus: 'clip' | 'voice' = 'clip'): ClipPlayback {
    let stopped = false;
    let source: AudioBufferSourceNode | null = null;
    let resolveDone: (value: 'played' | 'failed' | 'stopped') => void = () => undefined;
    const done = new Promise<'played' | 'failed' | 'stopped'>(resolve => {
      resolveDone = resolve;
    });
    const playback: ClipPlayback = {
      done,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source?.stop();
        } catch {
          // already stopped
        }
        resolveDone('stopped');
      },
    };
    void (async () => {
      try {
        const context = await audioBus.resume();
        const output = audioBus.bus(bus);
        if (!context || !output) throw new Error('audio unavailable');
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer.slice(0));
        if (stopped) return;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(output);
        source.onended = () => {
          if (stopped) return;
          stopped = true;
          resolveDone('played');
        };
        source.start();
      } catch (error) {
        if (stopped) return;
        stopped = true;
        console.warn('Could not play encoded audio:', error);
        resolveDone('failed');
      }
    })();
    return playback;
  }

  stopCurrentClip() {
    this.activeClip?.stop();
    this.activeClip = null;
  }
}

export const media = new MediaEngine();
