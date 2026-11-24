import { liveVoice, type LiveVoiceState } from './liveVoice.ts';
import { voiceBuzzer } from './voiceBuzzer.ts';

/**
 * Single entry point for "what did the players say".
 *
 * Transport preference:
 *   1. Gemini Live (server proxy)        – full AI host voice + transcription
 *   2. Browser Web Speech API            – transcription only, host uses TTS/text
 *   3. Typed commands                    – always available (accessibility + tests)
 *
 * Whatever the transport, every transcript is de-duplicated and forwarded to
 * the same listeners, so the game logic never cares where words came from.
 */
export type VoiceTransport = 'live' | 'web-speech' | 'typed';

export interface VoiceInputState {
  transport: VoiceTransport;
  /** Browser speech is standing in while the live host reconnects. */
  bridging: boolean;
  connecting: boolean;
  listening: boolean;
  suppressed: boolean;
  userSpeaking: boolean;
  lastTranscript: string;
  interimTranscript: string;
  error: string | null;
  live: LiveVoiceState;
}

type Listener = (state: VoiceInputState) => void;
type TranscriptListener = (transcript: string, source: VoiceTransport) => void;

/** Phrases speech models hallucinate on silence or room noise. */
const NOISE_PHRASES = new Set([
  'thank you', 'thanks', 'thank you for watching', 'thanks for watching', 'bye', 'goodbye', 'you', 'the', 'so', 'hmm', 'mm', 'mhm', 'uh', 'um', 'ah', 'oh',
  'music', 'applause', 'laughter', 'silence', 'subtitles', 'amara org', 'subtitles by the amara org community', 'i', 'a', 'and', 'but', 'hm', 'huh', 'thank',
]);

function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Decides whether a microphone transcript is real player speech.
 * Drops: empty/punctuation-only, known ASR hallucinations, and echoes of what
 * the host just said (speaker → microphone bleed right after a line ends).
 */
export function isLikelyNoise(transcript: string, hostLine: { text: string; endedAt: number } | null, now = Date.now()) {
  const tokens = words(transcript);
  if (!tokens.length) return true;
  const joined = tokens.join(' ');
  if (joined.replace(/[^a-z0-9]/g, '').length < 2) return true;
  if (NOISE_PHRASES.has(joined)) return true;
  if (hostLine && now - hostLine.endedAt < 3000) {
    // Echo = a verbatim run of the host's words. Short commands that merely reuse
    // a word or two from the prompt ("surprise me", "new theme") must get through.
    const hostTokens = words(hostLine.text);
    const hostGrams = new Set<string>();
    for (let index = 0; index + 4 <= hostTokens.length; index++) hostGrams.add(hostTokens.slice(index, index + 4).join(' '));
    for (let index = 0; index + 4 <= tokens.length; index++) {
      if (hostGrams.has(tokens.slice(index, index + 4).join(' '))) return true;
    }
    if (tokens.length >= 6 && tokens.length >= hostTokens.length * 0.6) {
      const hostSet = new Set(hostTokens);
      const overlap = tokens.filter(token => hostSet.has(token)).length / tokens.length;
      if (overlap >= 0.8) return true;
    }
  }
  return false;
}

class VoiceInput {
  private transport: VoiceTransport = 'typed';
  private connecting = false;
  private listeners: Listener[] = [];
  private transcriptListeners: TranscriptListener[] = [];
  private lastDispatched = { text: '', at: 0, source: 'typed' as VoiceTransport };
  private webSpeechError: string | null = null;
  private lastTranscript = '';
  private lastHostLine: { text: string; endedAt: number } | null = null;
  private lastIgnored = '';

  /** Web Speech is running as a stand-in while the live host is down. */
  private bridging = false;
  private liveWanted = false;

  constructor() {
    liveVoice.subscribe(state => {
      if (this.liveWanted && !this.connecting) this.reconcile(state);
      this.notify();
    });
    liveVoice.onTranscript(text => this.dispatch(text, 'live'));
    voiceBuzzer.onBuzzerSpoken(text => this.dispatch(text, 'web-speech'));
    voiceBuzzer.subscribe(state => {
      this.webSpeechError = state.errorMessage;
      this.notify();
    });
  }

  /**
   * Keeps the best transport active: live when it is connected, browser speech
   * while it is reconnecting (or unavailable at peak), typed otherwise. The game
   * never waits on the socket.
   */
  private reconcile(state: LiveVoiceState) {
    const liveUp = state.isEnabled && state.connection === 'ready';
    if (liveUp) {
      if (this.bridging) {
        voiceBuzzer.stop();
        this.bridging = false;
      }
      this.transport = 'live';
      return;
    }
    if (voiceBuzzer.getState().isSupported) {
      if (!this.bridging) {
        voiceBuzzer.start();
        this.bridging = true;
      }
      this.transport = 'web-speech';
    } else {
      this.transport = 'typed';
    }
  }

  getState(): VoiceInputState {
    const live = liveVoice.getState();
    const web = voiceBuzzer.getState();
    return {
      transport: this.transport,
      bridging: this.bridging,
      connecting: this.connecting,
      listening: this.transport === 'live' ? live.isListening && live.connection === 'ready' : this.transport === 'web-speech' ? web.isListening : false,
      suppressed: this.transport === 'live' ? live.isPlaybackSuppressed : web.isPlaybackSuppressed,
      userSpeaking: this.transport === 'live' ? live.isUserSpeaking : web.isSpeaking,
      lastTranscript: this.lastTranscript,
      interimTranscript: this.transport === 'live' ? live.interimTranscript : '',
      error: this.transport === 'live' ? live.errorMessage : this.transport === 'web-speech' ? (this.bridging ? live.errorMessage : this.webSpeechError) : live.errorMessage,
      live,
    };
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
    queueMicrotask(() => listener(this.getState()));
    return () => {
      this.listeners = this.listeners.filter(existing => existing !== listener);
    };
  }

  onTranscript(listener: TranscriptListener) {
    this.transcriptListeners.push(listener);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter(existing => existing !== listener);
    };
  }

  /**
   * Starts voice input. The live host connects in the background; after a short
   * grace period the game proceeds on whatever transport is ready and upgrades
   * to live the moment it connects.
   */
  async start(options: { theme?: string; graceMs?: number } = {}): Promise<VoiceTransport> {
    this.connecting = true;
    this.liveWanted = true;
    this.notify();
    try {
      const live = liveVoice.start({ theme: options.theme, requireMicrophone: false });
      const grace = new Promise<false>(resolve => setTimeout(() => resolve(false), options.graceMs ?? 2500));
      await Promise.race([live, grace]);
      this.reconcile(liveVoice.getState());
      void live.then(() => this.reconcile(liveVoice.getState()));
      return this.transport;
    } finally {
      this.connecting = false;
      this.notify();
    }
  }

  stop() {
    this.liveWanted = false;
    this.bridging = false;
    liveVoice.stop();
    voiceBuzzer.stop();
    this.transport = 'typed';
    this.notify();
  }

  /** Typed fallback and test hook: behaves exactly like a spoken transcript. */
  inject(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.dispatch(trimmed, 'typed');
  }

  setPlaybackSuppressed(source: string, suppressed: boolean) {
    liveVoice.setPlaybackSuppressed(source, suppressed);
    voiceBuzzer.setPlaybackSuppressed(source, suppressed);
  }

  /** The host engine reports what it is saying so echoes can be recognised and dropped. */
  noteHostLine(text: string, ended: boolean) {
    this.lastHostLine = { text, endedAt: ended ? Date.now() : Number.POSITIVE_INFINITY };
  }

  /** Last transcript that was discarded as noise/echo (for the UI). */
  getLastIgnored() {
    return this.lastIgnored;
  }

  private dispatch(text: string, source: VoiceTransport) {
    const now = Date.now();
    if (source !== 'typed' && isLikelyNoise(text, this.lastHostLine && Number.isFinite(this.lastHostLine.endedAt) ? this.lastHostLine : this.lastHostLine ? { ...this.lastHostLine, endedAt: now } : null, now)) {
      this.lastIgnored = text;
      this.notify();
      return;
    }
    if (text.toLowerCase() === this.lastDispatched.text && now - this.lastDispatched.at < 1200 && source !== 'typed' && source === this.lastDispatched.source) return;
    this.lastDispatched = { text: text.toLowerCase(), at: now, source };
    this.lastTranscript = text;
    this.notify();
    this.transcriptListeners.forEach(listener => listener(text, source));
  }

  private notify() {
    const snapshot = this.getState();
    queueMicrotask(() => this.listeners.forEach(listener => listener(snapshot)));
  }
}

export const voiceInput = new VoiceInput();
