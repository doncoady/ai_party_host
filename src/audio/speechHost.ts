import { liveVoice } from '../speech/liveVoice.ts';
import { voiceInput } from '../speech/voiceInput.ts';
import { fetchSpeech } from '../services/api.ts';
import { media } from './mediaEngine.ts';

/**
 * Host voice, tuned for an uninterrupted show.
 *
 * Scripted lines (the vast majority) climb this ladder:
 *   1. cached Gemini TTS render (pre-fetched for upcoming turns)  – instant
 *   2. Gemini Live, if connected                                  – preferred live voice
 *   3. Gemini TTS fetch, unless it is rate-limited                – a second or two
 *   4. browser speech synthesis                                   – always available
 *   5. text subtitles with a reading-time delay
 * Improvised lines (intro, game over) start at step 2.
 *
 * Rate limits (HTTP 429/503) are detected and honoured with a backoff so
 * prefetching never hammers the API, and every `speak` call gets exactly one
 * completion, guarded by bounded watchdogs: a live turn that produces no audio
 * within a few seconds is handed to the next tier instead of stalling the game.
 */
export interface HostSpeechOptions {
  /** Direction for the live host to riff; the text itself is the fallback script. */
  improv?: string;
  style?: string;
  onEnd?: () => void;
  interrupt?: boolean;
}

export type HostTier = 'live' | 'tts' | 'browser' | 'text';

export interface HostSpeechState {
  subtitle: string;
  isSpeaking: boolean;
  tier: HostTier | null;
  /** Most recent completed line, kept so players can re-read what the host said. */
  lastLine: string;
  lastLineAt: number;
  /** Gemini TTS is backing off after a rate limit (epoch ms until retry). */
  ttsBackoffUntil: number;
}

type Listener = (state: HostSpeechState) => void;

/** Reading-time estimate used for watchdogs and the text-only tier. */
export function estimateSpeechMs(text: string, tier: HostTier) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const base = tier === 'text' ? 600 + words * 110 : 1200 + words * 420;
  return Math.min(tier === 'text' ? 6000 : 30_000, base);
}

/** How long to wait for the live model to start talking before moving to the next tier. */
const LIVE_FIRST_AUDIO_MS = 4500;
const CACHE_LIMIT = 300;
const PREFETCH_SPACING_MS = 600;

class HostEngine {
  private state: HostSpeechState = { subtitle: '', isSpeaking: false, tier: null, lastLine: '', lastLineAt: 0, ttsBackoffUntil: 0 };
  private listeners: Listener[] = [];
  private muted = false;
  private requestId = 0;
  private activeTurnId: number | null = null;
  private activeOnEnd: (() => void) | null = null;
  private watchdog: number | null = null;
  private firstAudioWatchdog: number | null = null;
  private textTimer: number | null = null;
  private playback: { stop(): void } | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private releaseMicTimer: number | null = null;
  private queue: Array<{ text: string; options: HostSpeechOptions }> = [];
  /** Speeds up the text-only tier in tests. */
  private speedFactor = 1;
  /** Browser speech synthesis can be disabled (tests, or rooms that dislike the robot voice). */
  private browserSpeechEnabled = true;
  /** Rendered speech by line text; filled by prefetch and by first use. */
  private audioCache = new Map<string, string>();
  private inflight = new Map<string, Promise<string | null>>();
  private prefetchQueue: string[] = [];
  private prefetchTimer: number | null = null;
  private prefetchBusy = false;

  constructor() {
    liveVoice.onTurn(({ turnId }) => {
      if (turnId !== this.activeTurnId) return;
      this.finish();
    });
    liveVoice.subscribe(state => {
      if (this.state.tier === 'live' && this.state.isSpeaking && state.outputTranscript) this.setState({ subtitle: state.outputTranscript });
    });
  }

  getState() {
    return { ...this.state };
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    queueMicrotask(() => listener(this.getState()));
    return () => {
      this.listeners = this.listeners.filter(existing => existing !== listener);
    };
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    liveVoice.setMuted(muted);
    if (muted) window.speechSynthesis?.cancel();
  }

  getMuted() {
    return this.muted;
  }

  setSpeedFactor(factor: number) {
    this.speedFactor = Math.max(0.05, factor);
  }

  setBrowserSpeechEnabled(enabled: boolean) {
    this.browserSpeechEnabled = enabled;
  }

  stop() {
    this.requestId++;
    this.queue = [];
    this.activeOnEnd = null;
    this.activeTurnId = null;
    this.clearTimers();
    this.playback?.stop();
    this.playback = null;
    this.cancelBrowserSpeech();
    liveVoice.cancelTurns();
    this.setState({ subtitle: '', isSpeaking: false, tier: null });
    this.releaseMic();
  }

  /**
   * Speaks a line. With `interrupt: false` the line waits for the current one
   * (flow lines never cut the host mid-sentence); otherwise it cuts in.
   */
  speak(text: string, options: HostSpeechOptions = {}) {
    const trimmed = text.trim();
    if (options.interrupt === false && (this.state.isSpeaking || this.queue.length)) {
      this.queue.push({ text: trimmed, options });
      return;
    }
    if (options.interrupt !== false) this.stop();
    this.begin(trimmed, options);
  }

  private begin(trimmed: string, options: HostSpeechOptions) {
    if (!trimmed) {
      options.onEnd?.();
      this.pumpQueue(this.requestId);
      return;
    }
    const requestId = ++this.requestId;
    this.activeOnEnd = options.onEnd ?? null;

    if (this.muted) {
      this.setState({ subtitle: trimmed, isSpeaking: true, tier: 'text' });
      this.scheduleTextEnd(trimmed);
      return;
    }

    voiceInput.noteHostLine(trimmed, false);
    this.holdMic();
    media.duckMusic('host', true);
    const cached = options.improv ? null : this.audioCache.get(trimmed);
    if (cached) {
      void this.playRendered(trimmed, cached, requestId, options);
      return;
    }
    if (this.speakLive(trimmed, options)) return;
    void this.speakWithTts(trimmed, options, requestId);
  }

  // ----------------------------------------------------------------- tiers
  private speakLive(trimmed: string, options: HostSpeechOptions) {
    const turnId = liveVoice.isReady()
      ? liveVoice.sendText(options.improv ? `${options.improv}\nScripted fallback: "${trimmed}"` : trimmed, options.improv ? 'improv' : 'say')
      : null;
    if (turnId === null) return false;
    const requestId = this.requestId;
    this.activeTurnId = turnId;
    this.setState({ subtitle: trimmed, isSpeaking: true, tier: 'live' });
    this.armWatchdog(estimateSpeechMs(trimmed, 'live') + 4000);
    // If the model says nothing for a while, do not wait: take the line down the ladder.
    this.firstAudioWatchdog = window.setTimeout(() => {
      this.firstAudioWatchdog = null;
      if (requestId !== this.requestId || this.activeTurnId !== turnId) return;
      if (liveVoice.hasOutputFor(turnId)) return;
      console.warn('Live host did not start speaking; falling back for this line.');
      this.activeTurnId = null;
      liveVoice.cancelTurns();
      void this.speakWithTts(trimmed, { ...options, improv: undefined }, requestId);
    }, LIVE_FIRST_AUDIO_MS);
    // Fill the cache for next time without blocking (respects backoff).
    if (!options.improv) this.prefetch([trimmed]);
    return true;
  }

  private async speakWithTts(text: string, options: HostSpeechOptions, requestId: number) {
    this.setState({ subtitle: text, isSpeaking: true, tier: 'tts' });
    if (Date.now() < this.state.ttsBackoffUntil) {
      this.speakWithBrowserOrText(text, requestId);
      return;
    }
    this.armWatchdog(12_000);
    const audio = await this.fetchAudio(text);
    if (requestId !== this.requestId) return;
    if (audio) {
      await this.playRendered(text, audio, requestId, options);
      return;
    }
    // Rate-limited or down: the live host may have come back meanwhile, else browser speech.
    if (this.speakLive(text, { ...options, improv: undefined })) return;
    this.speakWithBrowserOrText(text, requestId);
  }

  private async playRendered(text: string, audio: string, requestId: number, options: HostSpeechOptions) {
    void options;
    this.setState({ subtitle: text, isSpeaking: true, tier: 'tts' });
    const playback = media.playEncodedAudio(audio, 'voice');
    this.playback = playback;
    this.armWatchdog(estimateSpeechMs(text, 'tts') + 4000);
    const result = await playback.done;
    if (requestId !== this.requestId) return;
    if (result === 'failed') {
      this.speakWithBrowserOrText(text, requestId);
      return;
    }
    this.finish();
  }

  private speakWithBrowserOrText(text: string, requestId: number) {
    if (requestId !== this.requestId) return;
    if (this.speakWithBrowser(text, requestId)) return;
    this.setState({ tier: 'text' });
    this.scheduleTextEnd(text);
  }

  /** Browser speech synthesis: no network, no quota, always there. */
  private speakWithBrowser(text: string, requestId: number) {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!this.browserSpeechEnabled || !synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
    try {
      const voices = synth.getVoices();
      if (!voices.length) return false;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1;
      const preferred = voices.find(voice => /en[-_]/i.test(voice.lang) && /google|natural|premium|enhanced/i.test(voice.name)) ?? voices.find(voice => /en[-_]/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      utterance.onend = () => {
        if (requestId !== this.requestId) return;
        this.utterance = null;
        this.finish();
      };
      utterance.onerror = () => {
        if (requestId !== this.requestId) return;
        this.utterance = null;
        this.setState({ tier: 'text' });
        this.scheduleTextEnd(text);
      };
      this.utterance = utterance;
      this.setState({ subtitle: text, isSpeaking: true, tier: 'browser' });
      this.armWatchdog(estimateSpeechMs(text, 'browser') + 4000);
      synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  private cancelBrowserSpeech() {
    if (!this.utterance) return;
    this.utterance.onend = null;
    this.utterance.onerror = null;
    this.utterance = null;
    window.speechSynthesis?.cancel();
  }

  // ---------------------------------------------------------------- cache
  /** Pre-renders lines the game is likely to say next. Cheap to call often; rate-aware. */
  prefetch(texts: string[]) {
    if (this.muted) return;
    for (const text of texts) {
      const key = text.trim();
      if (!key || this.audioCache.has(key) || this.inflight.has(key) || this.prefetchQueue.includes(key)) continue;
      this.prefetchQueue.push(key);
    }
    this.pumpPrefetch();
  }

  private pumpPrefetch() {
    if (this.prefetchBusy || this.prefetchTimer !== null || !this.prefetchQueue.length) return;
    const wait = Math.max(0, this.state.ttsBackoffUntil - Date.now());
    this.prefetchTimer = window.setTimeout(() => {
      this.prefetchTimer = null;
      const key = this.prefetchQueue.shift();
      if (!key) return;
      this.prefetchBusy = true;
      void this.fetchAudio(key).finally(() => {
        this.prefetchBusy = false;
        this.prefetchTimer = window.setTimeout(() => {
          this.prefetchTimer = null;
          this.pumpPrefetch();
        }, PREFETCH_SPACING_MS);
      });
    }, wait);
  }

  private fetchAudio(key: string): Promise<string | null> {
    const cached = this.audioCache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    if (Date.now() < this.state.ttsBackoffUntil) return Promise.resolve(null);
    const request = fetchSpeech(key).then(result => {
      if (result.audio) {
        this.remember(key, result.audio);
        return result.audio;
      }
      // 429 = quota; 503 = not configured/down. Back off accordingly so prefetch and play stop asking.
      const seconds = result.retryAfterSeconds ?? (result.status === 429 ? 30 : result.status === 503 ? 120 : result.status === 0 ? 20 : 60);
      this.setState({ ttsBackoffUntil: Date.now() + seconds * 1000 });
      if (result.status === 429) console.warn(`Gemini TTS rate limit hit; backing off for ${seconds} s (live host / browser speech will cover).`);
      return null;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private remember(key: string, audio: string) {
    if (this.audioCache.size >= CACHE_LIMIT) {
      const oldest = this.audioCache.keys().next().value;
      if (oldest !== undefined) this.audioCache.delete(oldest);
    }
    this.audioCache.set(key, audio);
    if (this.state.ttsBackoffUntil) this.setState({ ttsBackoffUntil: 0 });
  }

  // ----------------------------------------------------------- completion
  private scheduleTextEnd(text: string) {
    this.clearTimers();
    const delay = estimateSpeechMs(text, 'text') * this.speedFactor;
    this.textTimer = window.setTimeout(() => {
      this.textTimer = null;
      this.finish();
    }, delay);
  }

  private armWatchdog(ms: number) {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => {
      this.watchdog = null;
      console.warn('Host speech watchdog fired; continuing the game.');
      this.finish();
    }, ms);
  }

  private finish() {
    const onEnd = this.activeOnEnd;
    this.activeOnEnd = null;
    this.activeTurnId = null;
    this.clearTimers();
    this.playback = null;
    this.utterance = null;
    media.duckMusic('host', false);
    if (this.state.subtitle) voiceInput.noteHostLine(this.state.subtitle, true);
    this.setState({ subtitle: '', isSpeaking: false, tier: null, lastLine: this.state.subtitle || this.state.lastLine, lastLineAt: Date.now() });
    this.releaseMic();
    const before = this.requestId;
    onEnd?.();
    this.pumpQueue(before);
  }

  /** Continue with queued lines unless the completion handler started something new. */
  private pumpQueue(before: number) {
    if (this.requestId === before && !this.state.isSpeaking && this.queue.length) {
      const next = this.queue.shift()!;
      this.begin(next.text, next.options);
    }
  }

  private clearTimers() {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog);
    if (this.firstAudioWatchdog !== null) window.clearTimeout(this.firstAudioWatchdog);
    if (this.textTimer !== null) window.clearTimeout(this.textTimer);
    this.watchdog = null;
    this.firstAudioWatchdog = null;
    this.textTimer = null;
  }

  private holdMic() {
    if (this.releaseMicTimer !== null) {
      window.clearTimeout(this.releaseMicTimer);
      this.releaseMicTimer = null;
    }
    voiceInput.setPlaybackSuppressed('host', true);
  }

  /** Keeps the mic muted briefly after the host stops so room echo is not transcribed. */
  private releaseMic() {
    if (this.releaseMicTimer !== null) window.clearTimeout(this.releaseMicTimer);
    this.releaseMicTimer = window.setTimeout(() => {
      this.releaseMicTimer = null;
      voiceInput.setPlaybackSuppressed('host', false);
    }, 600);
  }

  private setState(changes: Partial<HostSpeechState>) {
    this.state = { ...this.state, ...changes };
    const snapshot = this.getState();
    queueMicrotask(() => this.listeners.forEach(listener => listener(snapshot)));
  }
}

export const host = new HostEngine();
