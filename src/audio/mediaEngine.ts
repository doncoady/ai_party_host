import { liveVoice } from '../speech/liveVoice.ts';

type SoundEffect = 'click' | 'correct' | 'incorrect' | 'start';

const SOUND_EFFECTS: Record<SoundEffect, string> = {
  click: '/audio/sfx/click_001.ogg',
  correct: '/audio/sfx/confirmation_003.ogg',
  incorrect: '/audio/sfx/error_002.ogg',
  start: '/audio/sfx/maximize_001.ogg',
};

class MediaEngine {
  private muted = false;
  private backgroundMusic: HTMLAudioElement | null = null;
  private currentClipStopFn: (() => void) | null = null;
  private audioContext: AudioContext | null = null;
  private musicListeners: Array<(isPlaying: boolean) => void> = [];
  private isMusicDucked = false;
  private musicFadeTimer: number | null = null;

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.backgroundMusic) this.backgroundMusic.muted = muted;
  }

  public setMusicDucked(ducked: boolean) {
    this.isMusicDucked = ducked;
    if (!this.backgroundMusic) return;
    if (this.musicFadeTimer !== null) window.clearInterval(this.musicFadeTimer);

    const audio = this.backgroundMusic;
    const startingVolume = audio.volume;
    const targetVolume = ducked ? 0.018 : 0.12;
    const startTime = performance.now();
    const fadeDuration = ducked ? 150 : 1500;
    this.musicFadeTimer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startTime) / fadeDuration);
      audio.volume = startingVolume + (targetVolume - startingVolume) * progress;
      if (progress === 1) {
        if (this.musicFadeTimer !== null) window.clearInterval(this.musicFadeTimer);
        this.musicFadeTimer = null;
      }
    }, 30);
  }

  public getMuted() {
    return this.muted;
  }

  public getBackgroundMusicStatus() {
    return Boolean(this.backgroundMusic && !this.backgroundMusic.paused);
  }

  public subscribeBackgroundMusic(listener: (isPlaying: boolean) => void) {
    this.musicListeners.push(listener);
    listener(this.getBackgroundMusicStatus());
    return () => {
      this.musicListeners = this.musicListeners.filter(existing => existing !== listener);
    };
  }

  private notifyBackgroundMusic() {
    const isPlaying = this.getBackgroundMusicStatus();
    this.musicListeners.forEach(listener => listener(isPlaying));
  }

  public async playEffect(effect: SoundEffect) {
    if (this.muted) return;
    const audio = new Audio(SOUND_EFFECTS[effect]);
    audio.volume = 0.55;
    try {
      await audio.play();
    } catch (error) {
      console.error(`Could not play ${effect} sound effect:`, error);
    }
  }

  public async toggleBackgroundMusic(enabled?: boolean) {
    const audio = this.backgroundMusic ?? new Audio('/audio/music/game-loop.mp3');
    this.backgroundMusic = audio;
    audio.loop = true;
    audio.volume = this.isMusicDucked ? 0.018 : 0.12;
    audio.muted = this.muted;
    audio.onplay = () => this.notifyBackgroundMusic();
    audio.onpause = () => this.notifyBackgroundMusic();
    const shouldPlay = enabled ?? audio.paused;

    if (!shouldPlay) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (error) {
      console.error('Could not play background music:', error);
    }
  }

  public stopBackgroundMusic() {
    this.backgroundMusic?.pause();
    this.notifyBackgroundMusic();
  }

  public async playSongClip(songKey: string, onEnd?: () => void, maxDurationSeconds = 4) {
    this.stopCurrentClip();
    if (this.muted) {
      onEnd?.();
      return;
    }

    const controller = new AbortController();
    let source: AudioBufferSourceNode | null = null;
    let fallbackAudio: HTMLAudioElement | null = null;
    let clipTimeout: number | null = null;
    let finished = false;
    const finish = (continueGame: boolean, stopAudio = false) => {
      if (finished) return;
      finished = true;
      if (clipTimeout !== null) window.clearTimeout(clipTimeout);
      controller.abort();
      if (stopAudio && source) {
        try {
          source.stop();
        } catch (error) {
          if ((error as DOMException).name !== 'InvalidStateError') {
            console.warn('Unable to stop question audio:', error);
          }
        }
      }
      if (stopAudio && fallbackAudio) fallbackAudio.pause();
      source = null;
      fallbackAudio = null;
      this.currentClipStopFn = null;
      liveVoice.setPlaybackSuppressed('question-clip', false);
      this.setMusicDucked(false);
      if (continueGame) onEnd?.();
    };

    const stopClip = () => finish(false, true);
    this.currentClipStopFn = stopClip;
    liveVoice.setPlaybackSuppressed('question-clip', true);
    this.setMusicDucked(true);

    try {
      this.audioContext ??= new AudioContext();
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      const clipUrl = `/api/song-clip/${encodeURIComponent(songKey)}`;
      const response = await fetch(clipUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Question clip request failed: ${response.status}`);
      const audioData = await response.arrayBuffer();

      let audioBuffer: AudioBuffer | null = null;
      try {
        audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));
      } catch (error) {
        console.warn('Web Audio could not decode the question clip; trying native audio playback:', error);
      }

      if (finished) return;
      if (audioBuffer) {
        source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.onended = () => finish(true);
        clipTimeout = window.setTimeout(() => {
          finish(true, true);
        }, Math.min(maxDurationSeconds * 1000, audioBuffer.duration * 1000));
        source.start(0, 0, Math.min(maxDurationSeconds, audioBuffer.duration));
        return;
      }

      const audio = new Audio(clipUrl);
      fallbackAudio = audio;
      audio.preload = 'auto';
      audio.onended = () => finish(true);
      audio.onerror = () => {
        console.error(`Could not play question clip "${songKey}":`, audio.error);
        finish(true);
      };
      clipTimeout = window.setTimeout(() => {
        finish(true, true);
      }, maxDurationSeconds * 1000);
      await audio.play();
    } catch (error) {
      console.error(`Could not start question clip "${songKey}":`, error);
      if ((error as DOMException).name !== 'AbortError') finish(true);
    }
  }

  public stopCurrentClip() {
    this.currentClipStopFn?.();
  }
}

export const media = new MediaEngine();
