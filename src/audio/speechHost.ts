import { liveVoice } from '../speech/liveVoice.ts';
import { media } from './mediaEngine.ts';
import type { Player, Question } from '../game/types.ts';

// Streams host dialogue with Gemini Live and keeps Gemini TTS as a fallback.

export interface HostSpeechOptions {
  voice?: string;
  speechStyle?: string;
  audioBase64?: string; // Pre-generated WAV audio
  onEnd?: () => void;
  interrupt?: boolean;
}

class HostEngine {
  private isSpeaking: boolean = false;
  private currentSubtitle: string = '';
  private subtitleListeners: Array<(subtitle: string, isSpeaking: boolean) => void> = [];
  private isMuted: boolean = false;
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private audioCache = new Map<string, string>();
  private speechRequestId = 0;
  private endTimer: number | null = null;
  private liveOnEnd?: () => void;
  private lastCompletedLiveTurn = 0;

  constructor() {
    this.lastCompletedLiveTurn = liveVoice.getState().completedTurns;
    liveVoice.subscribe(state => {
      if (state.outputTranscript) {
        this.notifySubtitles(state.outputTranscript, state.isOutputting);
      }
      if (state.completedTurns > this.lastCompletedLiveTurn) {
        this.lastCompletedLiveTurn = state.completedTurns;
        this.notifySubtitles('', false);
        const onEnd = this.liveOnEnd;
        this.liveOnEnd = undefined;
        onEnd?.();
      } else if (!state.isOutputting && !state.outputTranscript && this.currentSubtitle && this.liveOnEnd) {
        const onEnd = this.liveOnEnd;
        this.liveOnEnd = undefined;
        this.notifySubtitles('', false);
        onEnd();
      }
    });
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stop();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public subscribe(listener: (subtitle: string, isSpeaking: boolean) => void) {
    this.subtitleListeners.push(listener);
    queueMicrotask(() => {
      listener(this.currentSubtitle, this.isSpeaking);
    });
    return () => {
      this.subtitleListeners = this.subtitleListeners.filter(l => l !== listener);
    };
  }

  private notifySubtitles(subtitle: string, isSpeaking: boolean, suppressMicrophone = true) {
    this.currentSubtitle = subtitle;
    this.isSpeaking = isSpeaking;
    liveVoice.setPlaybackSuppressed('host', suppressMicrophone && isSpeaking);
    media.setMusicDucked(isSpeaking);
    queueMicrotask(() => {
      this.subtitleListeners.forEach(l => l(subtitle, isSpeaking));
    });
  }

  private stopCurrentAudio() {
    if (this.currentAudioSource) {
      this.currentAudioSource.onended = null;
      try {
        this.currentAudioSource.stop();
      } catch (err) {
        if ((err as DOMException).name !== 'InvalidStateError') {
          console.warn('Unable to stop host audio:', err);
        }
      }
      this.currentAudioSource = null;
    }
  }

  public prepareForPlayback() {
    if (typeof window === 'undefined') return;
    try {
      this.audioContext ??= new AudioContext();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(err => {
          console.warn('Could not activate host audio:', err);
        });
      }
    } catch (err) {
      console.warn('Host Web Audio is unavailable:', err);
    }
  }

  public stop() {
    this.speechRequestId++;
    this.liveOnEnd = undefined;
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.stopCurrentAudio();
    this.notifySubtitles('', false);
  }

  /**
   * Play pre-encoded base64 WAV audio (from Gemini TTS)
   */
  public async playAudioWav(base64Data: string, onEnd?: () => void, subtitle = this.currentSubtitle) {
    this.speechRequestId++;
    const requestId = this.speechRequestId;
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.stopCurrentAudio();
    if (this.isMuted) {
      this.notifySubtitles('', false);
      if (onEnd) onEnd();
      return;
    }

    this.prepareForPlayback();
    this.notifySubtitles(subtitle, true);

    try {
      const context = this.audioContext;
      if (!context) throw new Error('Host audio context is unavailable');

      const binary = atob(base64Data);
      const audioBytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const buffer = await context.decodeAudioData(audioBytes.buffer);
      if (requestId !== this.speechRequestId) return;
      if (context.state === 'suspended') await context.resume();
      if (requestId !== this.speechRequestId) return;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.currentAudioSource = source;
      source.onended = () => {
        if (requestId !== this.speechRequestId) return;
        if (this.endTimer !== null) {
          window.clearTimeout(this.endTimer);
          this.endTimer = null;
        }
        this.currentAudioSource = null;
        this.notifySubtitles('', false);
        onEnd?.();
      };
      source.start();
      this.endTimer = window.setTimeout(() => {
        if (requestId !== this.speechRequestId) return;
        this.endTimer = null;
        this.stopCurrentAudio();
        this.notifySubtitles('', false);
        onEnd?.();
      }, Math.max(3000, Math.min(30000, buffer.duration * 1000 + 2000)));
    } catch (err) {
      if (requestId !== this.speechRequestId) return;
      console.warn('Could not decode or play host audio:', err);
      this.notifySubtitles('', false);
      onEnd?.();
    }
  }

  /**
   * Speak text using the Gemini-generated host voice.
   */
  public async speak(text: string, options: HostSpeechOptions = {}) {
    if (!text || !text.trim()) return;

    if (options.interrupt !== false) {
      this.stop();
    }
    const requestId = ++this.speechRequestId;

    const trimmed = text.trim();

    if (this.isMuted) {
      this.notifySubtitles(trimmed, false);
      this.scheduleTextOnlyEnd(trimmed, requestId, options.onEnd);
      return;
    }

    if (liveVoice.sendText(trimmed)) {
      this.liveOnEnd = options.onEnd;
      this.notifySubtitles(trimmed, true);
      return;
    }
    this.notifySubtitles(trimmed, true);

    // If pre-supplied audioBase64 exists
    if (options.audioBase64) {
      this.playAudioWav(options.audioBase64, options.onEnd, trimmed);
      return;
    }

    // Check client-side memory cache
    const cacheKey = trimmed.toLowerCase();
    if (this.audioCache.has(cacheKey)) {
      this.playAudioWav(this.audioCache.get(cacheKey)!, options.onEnd, trimmed);
      return;
    }

    // Request authentic voice audio from server
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/api/host-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: trimmed,
          voice: options.voice || 'Kore',
          speechStyle: options.speechStyle,
        }),
      });

      if (requestId !== this.speechRequestId) return;
      if (!res.ok) throw new Error('TTS server error');
      const data = await res.json();
      if (data.audioBase64) {
        this.audioCache.set(cacheKey, data.audioBase64);
        this.playAudioWav(data.audioBase64, options.onEnd, trimmed);
        return;
      }
    } catch (err) {
      if (requestId !== this.speechRequestId) return;
      console.warn('Gemini TTS failed; showing the host line as text:', err);
    } finally {
      window.clearTimeout(requestTimeout);
    }

    this.scheduleTextOnlyEnd(trimmed, requestId, options.onEnd);
  }

  private scheduleTextOnlyEnd(text: string, requestId: number, onEnd?: () => void) {
    const duration = 1200;
    this.notifySubtitles(text, false);
    this.endTimer = window.setTimeout(() => {
      if (requestId !== this.speechRequestId) return;
      this.endTimer = null;
      this.notifySubtitles('', false);
      if (onEnd) onEnd();
    }, duration);
  }

  public async fetchQuestionNarration(
    question: Question,
    players: Player[],
    isOpening: boolean
  ): Promise<{ text: string; audioBase64?: string } | null> {
    try {
      const res = await fetch('/api/host-narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOpening,
          question: {
            category: question.category,
            title: question.title,
            question: question.question,
            explanation: question.explanation,
          },
          players: players.map(({ name, score }) => ({ name, score })),
        }),
      });
      if (!res.ok) throw new Error(`Host narration request failed: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('AI host narration unavailable; using the scripted intro:', err);
      return null;
    }
  }

  /**
   * Request dynamic AI host roast/commentary with generated voice audio
   */
  public async fetchDynamicRoast(params: {
    playerName: string;
    score: number;
    questionText: string;
    chosenAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;
    useLiveHost?: boolean;
  }): Promise<{ roastText: string; audioBase64?: string }> {
    try {
      const res = await fetch('/api/host-roast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      return {
        roastText: data.roast,
        audioBase64: data.audioBase64,
      };
    } catch {
      const fallbacks = params.isCorrect
        ? [
            `Boom! ${params.playerName} nails it! You must have spent your entire allowance on arcade tokens.`,
            `Bingo! Look at you, a certified 80s cultural artifact!`,
          ]
        : [
            `Oof! Incorrect, ${params.playerName}! That answer was so bad, MTV canceled music videos again.`,
            `Wrong! ${params.playerName}, that was totally bogus! Minus cash for you.`,
          ];
      const text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      return { roastText: text };
    }
  }

  /**
   * Play character sound byte (Doc Brown, Terminator, Ferris Bueller, etc.)
   */
  public async playCharacterSoundByte(quoteKey: string, text: string, character: string, onEnd?: () => void) {
    this.stop();
    const requestId = ++this.speechRequestId;
    this.notifySubtitles(`"${text}"`, true);
    try {
      const res = await fetch('/api/character-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteKey, text, character }),
      });
      if (res.ok) {
        const data = await res.json();
        if (requestId !== this.speechRequestId) return;
        if (data.audioBase64) {
          this.playAudioWav(data.audioBase64, onEnd, `"${text}"`);
          return;
        }
      }
    } catch (err) {
      if (requestId !== this.speechRequestId) return;
      console.warn('Character quote API failed, falling back:', err);
    }

    // Fallback speak
    if (requestId === this.speechRequestId) {
      this.speak(text, { onEnd, interrupt: false });
    }
  }
}

export const host = new HostEngine();
