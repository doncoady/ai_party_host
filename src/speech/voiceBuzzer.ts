// Real-time Continuous Voice Interaction Engine (Web Speech API + Live AI Host Conversation)

export interface VoiceRecognitionState {
  isListening: boolean;
  isEnabled: boolean;
  isPlaybackSuppressed: boolean;
  isSupported: boolean;
  lastTranscript: string;
  isSpeaking: boolean;
  errorMessage: string | null;
}

export type VoiceListener = (state: VoiceRecognitionState) => void;
export type VoiceBuzzerCallback = (transcript: string) => void;

export function shouldDispatchVoiceTranscript(
  isFinal: boolean,
  isPlaybackSuppressed: boolean,
  now: number,
  ignoreResultsUntil: number
): boolean {
  return isFinal && !isPlaybackSuppressed && now >= ignoreResultsUntil;
}

class VoiceBuzzerEngine {
  private recognition: any = null;
  private isListening: boolean = false;
  private isSupported: boolean = false;
  private lastTranscript: string = '';
  private isUserSpeaking: boolean = false;
  private speechTimeout: number | null = null;
  private errorMessage: string | null = null;
  private stateListeners: VoiceListener[] = [];
  private buzzerCallbacks: VoiceBuzzerCallback[] = [];
  private shouldKeepListening: boolean = false;
  private isPlaybackSuppressed: boolean = false;
  private playbackSuppressionSources = new Set<string>();
  private ignoreResultsUntil = 0;
  private lastDispatchedTranscript = '';
  private lastDispatchedAt = 0;

  constructor() {
    const win: any = typeof window !== 'undefined' ? window : {};
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    this.isSupported = !!SpeechRec;

    if (this.isSupported) {
      try {
        this.recognition = new SpeechRec();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          if (this.isPlaybackSuppressed || !this.shouldKeepListening) {
            this.recognition.stop();
            this.isListening = false;
            return;
          }
          this.isListening = true;
          this.errorMessage = null;
          this.notify();
        };

        this.recognition.onspeechstart = () => {
          this.isUserSpeaking = true;
          this.notify();
        };

        this.recognition.onspeechend = () => {
          this.isUserSpeaking = false;
          this.notify();
        };

        this.recognition.onresult = (event: any) => {
          const results = event.results;
          if (!results || results.length === 0) return;

          const startIndex = Number.isInteger(event.resultIndex)
            ? event.resultIndex
            : results.length - 1;

          for (let index = startIndex; index < results.length; index++) {
            const transcript = results[index][0]?.transcript?.trim() || '';
            if (!transcript) continue;

            this.lastTranscript = transcript;
            this.isUserSpeaking = true;
            this.notify();

            if (!this.speechTimeout) {
              this.speechTimeout = window.setTimeout(() => {
                this.isUserSpeaking = false;
                this.speechTimeout = null;
                this.notify();
              }, 1400);
            } else {
              clearTimeout(this.speechTimeout);
              this.speechTimeout = window.setTimeout(() => {
                this.isUserSpeaking = false;
                this.speechTimeout = null;
                this.notify();
              }, 1400);
            }

            if (!shouldDispatchVoiceTranscript(
              results[index].isFinal,
              this.isPlaybackSuppressed,
              Date.now(),
              this.ignoreResultsUntil
            )) {
              continue;
            }

            const now = Date.now();
            if (transcript.toLowerCase() === this.lastDispatchedTranscript && now - this.lastDispatchedAt < 1200) {
              continue;
            }

            this.lastDispatchedTranscript = transcript.toLowerCase();
            this.lastDispatchedAt = now;
            this.buzzerCallbacks.forEach(cb => cb(transcript));
          }
        };

        this.recognition.onerror = (event: any) => {
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            this.errorMessage = event.error;
          }
          this.notify();
        };

        this.recognition.onend = () => {
          this.isListening = false;
          this.isUserSpeaking = false;
          this.notify();

          // Auto-restart if active game session requires continuous listening
          if (this.shouldKeepListening && !this.isPlaybackSuppressed) {
            this.startRecognition();
          }
        };
      } catch (err: any) {
        this.isSupported = false;
        this.errorMessage = err?.message || 'Voice recognition initialization failed';
      }
    }
  }

  public subscribe(listener: VoiceListener) {
    this.stateListeners.push(listener);
    queueMicrotask(() => {
      listener(this.getState());
    });
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  public onBuzzerSpoken(cb: VoiceBuzzerCallback) {
    this.buzzerCallbacks.push(cb);
    return () => {
      this.buzzerCallbacks = this.buzzerCallbacks.filter(c => c !== cb);
    };
  }

  public start() {
    if (!this.isSupported || !this.recognition) return;
    this.shouldKeepListening = true;
    this.startRecognition();
  }

  public stop() {
    this.shouldKeepListening = false;
    if (this.speechTimeout) {
      clearTimeout(this.speechTimeout);
      this.speechTimeout = null;
    }
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        if ((err as DOMException).name !== 'InvalidStateError') {
          this.errorMessage = 'Could not stop voice recognition';
        }
      }
    }
    this.isListening = false;
    this.isUserSpeaking = false;
    this.notify();
  }

  public setPlaybackSuppressed(source: string, suppressed: boolean) {
    if (suppressed) {
      this.playbackSuppressionSources.add(source);
    } else {
      this.playbackSuppressionSources.delete(source);
    }

    const isSuppressed = this.playbackSuppressionSources.size > 0;
    if (this.isPlaybackSuppressed === isSuppressed) return;
    this.isPlaybackSuppressed = isSuppressed;

    if (isSuppressed) {
      if (this.speechTimeout) {
        clearTimeout(this.speechTimeout);
        this.speechTimeout = null;
      }
      this.isUserSpeaking = false;
      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
        } catch (err) {
          if ((err as DOMException).name !== 'InvalidStateError') {
            this.errorMessage = 'Could not pause voice recognition for audio playback';
          }
        }
      }
      this.isListening = false;
    } else if (this.shouldKeepListening) {
      this.ignoreResultsUntil = Date.now() + 600;
      this.startRecognition();
    }

    this.notify();
  }

  private startRecognition() {
    if (!this.recognition || !this.shouldKeepListening || this.isPlaybackSuppressed || this.isListening) return;
    try {
      this.recognition.start();
    } catch (err) {
      if ((err as DOMException).name !== 'InvalidStateError') {
        this.errorMessage = 'Could not start voice recognition';
        this.notify();
      }
    }
  }

  public getState(): VoiceRecognitionState {
    return {
      isListening: this.isListening,
      isEnabled: this.shouldKeepListening,
      isPlaybackSuppressed: this.isPlaybackSuppressed,
      isSupported: this.isSupported,
      lastTranscript: this.lastTranscript,
      isSpeaking: this.isUserSpeaking,
      errorMessage: this.errorMessage,
    };
  }

  private notify() {
    const s = this.getState();
    queueMicrotask(() => {
      this.stateListeners.forEach(l => l(s));
    });
  }

}

export const voiceBuzzer = new VoiceBuzzerEngine();
