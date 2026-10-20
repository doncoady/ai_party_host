// Real-time Continuous Voice Interaction Engine (Web Speech API + Live AI Host Conversation)

export interface VoiceRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  lastTranscript: string;
  isSpeaking: boolean;
  errorMessage: string | null;
}

export type VoiceListener = (state: VoiceRecognitionState) => void;
export type VoiceBuzzerCallback = (transcript: string) => void;

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

          const latest = results[results.length - 1];
          const transcript = latest[0]?.transcript?.trim() || '';
          if (!transcript) return;

          this.lastTranscript = transcript;
          this.isUserSpeaking = true;
          this.notify();

          // Reset speech activity decay
          if (this.speechTimeout) clearTimeout(this.speechTimeout);
          this.speechTimeout = window.setTimeout(() => {
            this.isUserSpeaking = false;
            this.notify();
          }, 1400);

          // Dispatch to buzzer/intent callbacks
          this.buzzerCallbacks.forEach(cb => cb(transcript));
        };

        this.recognition.onerror = (event: any) => {
          if (event.error !== 'no-speech') {
            this.errorMessage = event.error;
          }
          this.notify();
        };

        this.recognition.onend = () => {
          this.isListening = false;
          this.isUserSpeaking = false;
          this.notify();

          // Auto-restart if active game session requires continuous listening
          if (this.shouldKeepListening) {
            try {
              this.recognition.start();
            } catch {}
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
    try {
      this.recognition.start();
    } catch {}
  }

  public stop() {
    this.shouldKeepListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.isListening = false;
    this.isUserSpeaking = false;
    this.notify();
  }

  public getState(): VoiceRecognitionState {
    return {
      isListening: this.isListening,
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

  /**
   * Converse directly with the AI Host in natural language
   */
  public async sendLiveConversation(params: {
    transcript: string;
    gameState: string;
    players: any[];
    currentQuestion?: any;
    activeBuzzerPlayerId?: string | null;
  }) {
    try {
      const res = await fetch('/api/host-converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Converse API failed');
      return await res.json();
    } catch (err) {
      console.warn('Live converse error:', err);
      return null;
    }
  }
}

export const voiceBuzzer = new VoiceBuzzerEngine();
