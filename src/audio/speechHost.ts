import { voiceBuzzer } from '../speech/voiceBuzzer.ts';

// Authentic Human AI Host Voice Engine powered by Gemini 3.8 Flash TTS

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
  private currentAudioElement: HTMLAudioElement | null = null;
  private audioCache = new Map<string, string>();
  private speechRequestId = 0;
  private endTimer: number | null = null;

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

  private notifySubtitles(subtitle: string, isSpeaking: boolean) {
    this.currentSubtitle = subtitle;
    this.isSpeaking = isSpeaking;
    voiceBuzzer.setPlaybackSuppressed('host', isSpeaking);
    queueMicrotask(() => {
      this.subtitleListeners.forEach(l => l(subtitle, isSpeaking));
    });
  }

  private stopCurrentAudio() {
    if (!this.currentAudioElement) return;
    this.currentAudioElement.pause();
    this.currentAudioElement.currentTime = 0;
    this.currentAudioElement = null;
  }

  public stop() {
    this.speechRequestId++;
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
  public playAudioWav(base64Data: string, onEnd?: () => void, subtitle = this.currentSubtitle) {
    this.speechRequestId++;
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

    try {
      const audio = new Audio(`data:audio/wav;base64,${base64Data}`);
      this.currentAudioElement = audio;
      this.notifySubtitles(subtitle, true);
      let hasFinished = false;
      const finish = () => {
        if (hasFinished) return;
        hasFinished = true;
        if (this.currentAudioElement === audio) this.currentAudioElement = null;
        this.notifySubtitles('', false);
        if (onEnd) onEnd();
      };

      audio.onended = finish;
      audio.onerror = finish;

      audio.play().catch(() => {
        finish();
      });
    } catch {
      this.notifySubtitles('', false);
      if (onEnd) onEnd();
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
    try {
      const res = await fetch('/api/host-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    }

    this.scheduleTextOnlyEnd(trimmed, requestId, options.onEnd);
  }

  private scheduleTextOnlyEnd(text: string, requestId: number, onEnd?: () => void) {
    const duration = Math.max(2000, Math.min(6000, text.length * 60));
    this.endTimer = window.setTimeout(() => {
      if (requestId !== this.speechRequestId) return;
      this.endTimer = null;
      this.notifySubtitles('', false);
      if (onEnd) onEnd();
    }, duration);
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
