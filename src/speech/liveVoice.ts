import { audioBus } from '../audio/audioBus.ts';

/**
 * Gemini Live client: streams microphone PCM to the server proxy, plays the
 * host's audio, and surfaces transcripts. Host lines are sent as text turns;
 * `sendText` returns a turn handle whose completion fires once the host's
 * audio has actually finished playing (not merely when the model stops
 * generating), so game flow never runs ahead of the voice.
 */
export type LiveConnection = 'off' | 'connecting' | 'ready' | 'reconnecting' | 'error';

export interface LiveVoiceState {
  connection: LiveConnection;
  isEnabled: boolean;
  isListening: boolean;
  isPlaybackSuppressed: boolean;
  isSupported: boolean;
  mode: 'live' | 'mock' | null;
  lastTranscript: string;
  interimTranscript: string;
  outputTranscript: string;
  isUserSpeaking: boolean;
  isOutputting: boolean;
  errorMessage: string | null;
  completedTurns: number;
}

type Listener = (state: LiveVoiceState) => void;
type TranscriptListener = (transcript: string) => void;
type TurnListener = (event: { turnId: number; reason: 'complete' | 'interrupted' }) => void;

interface LiveServerEvent {
  type?: string;
  message?: string;
  text?: string;
  data?: string;
  sampleRate?: number;
  mode?: 'live' | 'mock';
  fatal?: boolean;
  finished?: boolean;
  timeLeft?: string | null;
}

/** Fragments of one utterance are assembled until the API marks it finished or the room goes quiet. */
const UTTERANCE_SETTLE_MS = 900;
/** Initial buffering before the first audio chunk of a turn plays, to absorb network jitter. */
const JITTER_BUFFER_S = 0.18;

/** Reconnect backoff; after these, keep retrying every RECONNECT_PATIENT_MS while voice is enabled. */
const RECONNECT_DELAYS = [800, 1600, 3200, 6400, 12_800];
const RECONNECT_PATIENT_MS = 45_000;
const SOCKET_CONNECT_TIMEOUT_MS = 8000;

class LiveVoiceEngine {
  private state: LiveVoiceState = {
    connection: 'off',
    isEnabled: false,
    isListening: false,
    isPlaybackSuppressed: false,
    isSupported: typeof window !== 'undefined'
      && typeof WebSocket !== 'undefined'
      && typeof AudioContext !== 'undefined'
      && typeof AudioWorkletNode !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia),
    mode: null,
    lastTranscript: '',
    interimTranscript: '',
    outputTranscript: '',
    isUserSpeaking: false,
    isOutputting: false,
    errorMessage: null,
    completedTurns: 0,
  };
  private listeners: Listener[] = [];
  private transcriptListeners: TranscriptListener[] = [];
  private turnListeners: TurnListener[] = [];
  private suppressionSources = new Set<string>();
  private socket: WebSocket | null = null;
  private captureContext: AudioContext | null = null;
  private microphone: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private scheduled = new Set<AudioBufferSourceNode>();
  private nextPlaybackTime = 0;
  private muted = false;
  private startRequestId = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private theme: string | undefined;
  /** Theme last announced to the live model; a change is sent inline with the next line. */
  private announcedTheme: string | undefined;
  private turnCounter = 0;
  /** Turns we have sent that have not completed yet (FIFO). */
  private pendingTurns: Array<{ id: number; sentAt: number; sawOutput: boolean }> = [];
  private drainTimer: number | null = null;
  /** Test hook: allows the harness to bypass the microphone. */
  private allowMicFailure = false;
  private utteranceBuffer = '';
  private utteranceTimer: number | null = null;
  /** Set when the server announces the session is ending; we reconnect at the next quiet moment. */
  private goAwayPending = false;

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

  onTranscript(listener: TranscriptListener) {
    this.transcriptListeners.push(listener);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter(existing => existing !== listener);
    };
  }

  onTurn(listener: TurnListener) {
    this.turnListeners.push(listener);
    return () => {
      this.turnListeners = this.turnListeners.filter(existing => existing !== listener);
    };
  }

  isReady() {
    return this.state.connection === 'ready' && this.socket?.readyState === WebSocket.OPEN;
  }

  setTheme(theme: string) {
    this.theme = theme;
  }

  /** Connects the socket and microphone. Resolves true when the host is live. */
  async start(options: { theme?: string; requireMicrophone?: boolean } = {}): Promise<boolean> {
    if (options.theme !== undefined) this.theme = options.theme;
    if (this.state.isEnabled && this.state.connection === 'ready') return true;
    if (!this.state.isSupported) {
      this.update({ errorMessage: 'Live voice needs a browser with microphone and Web Audio support.', connection: 'error' });
      return false;
    }
    this.allowMicFailure = options.requireMicrophone === false;
    const requestId = ++this.startRequestId;
    this.reconnectAttempt = 0;
    this.update({ isEnabled: true, connection: 'connecting', errorMessage: null });
    try {
      await this.openSocket(requestId);
      if (requestId !== this.startRequestId) return false;
      // The host can speak as soon as the socket is up; the microphone follows.
      this.update({ connection: 'ready' });
      await this.openMicrophone(requestId);
      if (requestId !== this.startRequestId) return false;
      this.update({ isListening: Boolean(this.microphone) });
      return true;
    } catch (error) {
      if (requestId !== this.startRequestId) return false;
      const message = error instanceof Error ? error.message : 'Could not start live voice.';
      if (/microphone/i.test(message)) {
        this.stop(message);
        return false;
      }
      // The server/model was not reachable: keep trying in the background.
      this.closeSocket();
      this.scheduleReconnect(message);
      return false;
    }
  }

  /** Reconnects with a new theme so the host persona follows the game. */
  async restart(options: { theme?: string } = {}) {
    if (!this.state.isEnabled) return false;
    if (options.theme !== undefined) this.theme = options.theme;
    const requestId = ++this.startRequestId;
    this.closeSocket();
    this.update({ connection: 'connecting' });
    try {
      await this.openSocket(requestId);
      if (requestId !== this.startRequestId) return false;
      this.update({ connection: 'ready' });
      return true;
    } catch (error) {
      if (requestId !== this.startRequestId) return false;
      this.stop(error instanceof Error ? error.message : 'Could not reconnect live voice.');
      return false;
    }
  }

  stop(errorMessage: string | null = null) {
    this.startRequestId++;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.closeMicrophone();
    this.abandonPendingTurns();
    this.utteranceBuffer = '';
    if (this.utteranceTimer !== null) window.clearTimeout(this.utteranceTimer);
    this.utteranceTimer = null;
    this.goAwayPending = false;
    this.suppressionSources.clear();
    this.update({
      isEnabled: false,
      connection: errorMessage ? 'error' : 'off',
      isListening: false,
      isPlaybackSuppressed: false,
      isUserSpeaking: false,
      isOutputting: false,
      outputTranscript: '',
      interimTranscript: '',
      errorMessage,
    });
  }

  /** Sends a host line. Returns the turn id, or null when the live host is unavailable. */
  sendText(text: string, mode: 'say' | 'improv' = 'say'): number | null {
    const trimmed = text.trim();
    if (!trimmed || !this.isReady() || !this.socket) return null;
    const id = ++this.turnCounter;
    this.pendingTurns.push({ id, sentAt: performance.now(), sawOutput: false });
    let payload = trimmed;
    if (this.theme && this.theme !== this.announcedTheme) {
      this.announcedTheme = this.theme;
      payload = `[CONTEXT theme="${this.theme.replace(/"/g, "'")}"] ${trimmed}`;
    }
    this.socket.send(JSON.stringify({ type: 'text', text: payload, mode }));
    return id;
  }

  /** Cuts the host off (e.g. when the game interrupts a line). */
  cancelTurns() {
    this.pendingTurns = [];
    this.stopScheduledAudio();
    if (this.state.isOutputting || this.state.outputTranscript) this.update({ isOutputting: false, outputTranscript: '' });
  }

  /** Test/mock hook: asks the (mock) server to treat `text` as microphone speech. */
  injectTranscript(text: string) {
    if (this.socket?.readyState === WebSocket.OPEN && this.state.mode === 'mock') {
      this.socket.send(JSON.stringify({ type: 'debug_transcript', text }));
      return true;
    }
    return false;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopScheduledAudio();
  }

  /** Test hook: simulates a dropped connection (triggers the reconnect path). */
  simulateDrop() {
    this.socket?.close();
  }

  setPlaybackSuppressed(source: string, suppressed: boolean) {
    if (suppressed) this.suppressionSources.add(source);
    else this.suppressionSources.delete(source);
    const isPlaybackSuppressed = this.suppressionSources.size > 0;
    if (this.state.isPlaybackSuppressed !== isPlaybackSuppressed) this.update({ isPlaybackSuppressed });
  }

  // ----------------------------------------------------------------- socket
  private socketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/live`;
  }

  private openSocket(requestId: number) {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl());
      this.socket = socket;
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out connecting to the live host.'));
      }, SOCKET_CONNECT_TIMEOUT_MS);
      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        socket.removeEventListener('message', onFirstMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
        if (error) reject(error);
        else resolve();
      };
      const onFirstMessage = (event: MessageEvent<string>) => {
        let message: LiveServerEvent;
        try {
          message = JSON.parse(event.data) as LiveServerEvent;
        } catch {
          finish(new Error('The live host sent an invalid response.'));
          return;
        }
        if (message.type === 'ready') {
          if (requestId !== this.startRequestId) {
            socket.close();
            finish(new Error('Superseded'));
            return;
          }
          this.update({ mode: message.mode ?? 'live' });
          socket.addEventListener('message', this.handleMessage);
          socket.addEventListener('close', this.handleSocketClose);
          socket.addEventListener('error', this.handleSocketError);
          finish();
        } else if (message.type === 'error') {
          finish(new Error(message.message || 'The live host could not connect.'));
        }
      };
      const onError = () => finish(new Error('Could not connect to the live host.'));
      const onClose = () => finish(new Error('The live host connection closed unexpectedly.'));
      socket.addEventListener('open', () => {
        this.announcedTheme = this.theme;
        socket.send(JSON.stringify({ type: 'start', theme: this.theme }));
      }, { once: true });
      socket.addEventListener('message', onFirstMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    this.abandonPendingTurns();
    socket.removeEventListener('message', this.handleMessage);
    socket.removeEventListener('close', this.handleSocketClose);
    socket.removeEventListener('error', this.handleSocketError);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
      socket.close();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  private handleSocketClose = () => {
    if (!this.socket) return;
    this.socket = null;
    this.abandonPendingTurns();
    this.scheduleReconnect('The live host connection dropped.');
  };

  /** Any line in flight when the socket goes away is reported as interrupted so the game moves on at once. */
  private abandonPendingTurns() {
    const pending = this.pendingTurns;
    this.pendingTurns = [];
    this.stopScheduledAudio();
    if (this.state.isOutputting || this.state.outputTranscript) this.update({ isOutputting: false, outputTranscript: '' });
    for (const turn of pending) this.turnListeners.forEach(listener => listener({ turnId: turn.id, reason: 'interrupted' }));
  }

  /** True once the model has started responding to the given turn. */
  hasOutputFor(turnId: number) {
    return this.pendingTurns.some(turn => turn.id === turnId && turn.sawOutput) || !this.pendingTurns.some(turn => turn.id === turnId);
  }

  private handleSocketError = () => {
    if (!this.socket) return;
    this.socket.close();
  };

  private scheduleReconnect(reason: string) {
    if (!this.state.isEnabled) return;
    // Never give up while voice is enabled: Gemini Live capacity comes and goes at peak times,
    // and the game keeps flowing on browser speech / typed input in the meantime.
    const delay = RECONNECT_DELAYS[this.reconnectAttempt] ?? RECONNECT_PATIENT_MS;
    this.reconnectAttempt += 1;
    this.update({
      connection: delay === RECONNECT_PATIENT_MS ? 'error' : 'reconnecting',
      isOutputting: false,
      outputTranscript: '',
      errorMessage: delay === RECONNECT_PATIENT_MS ? `${reason} Retrying in the background.` : null,
    });
    const requestId = ++this.startRequestId;
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.openSocket(requestId);
        if (requestId !== this.startRequestId) return;
        this.reconnectAttempt = 0;
        this.update({ connection: 'ready', errorMessage: null });
        if (!this.microphone) {
          await this.openMicrophone(requestId).catch(() => undefined);
          if (requestId === this.startRequestId) this.update({ isListening: Boolean(this.microphone) });
        }
      } catch {
        if (requestId !== this.startRequestId) return;
        this.scheduleReconnect(reason);
      }
    }, delay);
  }

  // ------------------------------------------------------------- microphone
  private async openMicrophone(requestId: number) {
    if (this.microphone) return;
    try {
      const context = new AudioContext({ sampleRate: 16000 });
      this.captureContext = context;
      await context.audioWorklet.addModule('/audio/live-pcm-processor.js');
      if (requestId !== this.startRequestId) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (requestId !== this.startRequestId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.microphone = stream;
      if (context.state === 'suspended') await context.resume();
      this.micSource = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, 'live-pcm-capture');
      this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (this.socket?.readyState !== WebSocket.OPEN || this.state.isPlaybackSuppressed || !(event.data instanceof ArrayBuffer)) return;
        this.socket.send(JSON.stringify({ type: 'audio', data: toBase64(event.data) }));
      };
      this.micSource.connect(this.worklet);
      // Keep the worklet alive without feeding the mic to the speakers.
      const silence = context.createGain();
      silence.gain.value = 0;
      this.worklet.connect(silence).connect(context.destination);
    } catch (error) {
      this.closeMicrophone();
      if (this.allowMicFailure) {
        console.warn('Microphone unavailable; continuing with typed input:', error);
        return;
      }
      throw error instanceof Error ? new Error(`Microphone unavailable: ${error.message}`) : error;
    }
  }

  private closeMicrophone() {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.micSource?.disconnect();
    this.microphone?.getTracks().forEach(track => track.stop());
    this.worklet = null;
    this.micSource = null;
    this.microphone = null;
    if (this.captureContext) void this.captureContext.close().catch(() => undefined);
    this.captureContext = null;
  }

  // --------------------------------------------------------------- messages
  private handleMessage = (event: MessageEvent<string>) => {
    let message: LiveServerEvent;
    try {
      message = JSON.parse(event.data) as LiveServerEvent;
    } catch {
      return;
    }
    switch (message.type) {
      case 'input_transcript':
        this.collectUtterance(message.text ?? '', Boolean(message.finished));
        break;
      case 'go_away':
        this.goAwayPending = true;
        if (!this.pendingTurns.length) void this.rotateSocket();
        break;
      case 'interim_transcript':
        this.update({ interimTranscript: message.text?.trim() || '', isUserSpeaking: Boolean(message.text?.trim()) });
        break;
      case 'output_transcript':
        if (!this.pendingTurns.length) break;
        this.markOutput();
        this.update({ outputTranscript: `${this.state.outputTranscript} ${message.text ?? ''}`.trim().slice(-400), isOutputting: true });
        break;
      case 'audio':
        // Only voice lines we asked for are played; the model's own reactions to
        // microphone chatter are discarded so they never talk over the show.
        if (message.data && this.pendingTurns.length) {
          this.markOutput();
          this.playAudio(message.data, message.sampleRate || 24000);
        }
        break;
      case 'interrupted':
        this.stopScheduledAudio();
        this.update({ isOutputting: false, outputTranscript: '' });
        this.completeTurn('interrupted');
        break;
      case 'turn_complete':
        this.completeTurn('complete');
        break;
      case 'error':
        this.update({ errorMessage: message.message || 'Live host error.' });
        if (message.fatal) this.socket?.close();
        break;
      default:
        break;
    }
  };

  /** Assembles transcript fragments into one utterance before anyone hears about it. */
  private collectUtterance(fragment: string, finished: boolean) {
    if (fragment) {
      const needsSpace = this.utteranceBuffer && !this.utteranceBuffer.endsWith(' ') && !fragment.startsWith(' ');
      this.utteranceBuffer += (needsSpace ? ' ' : '') + fragment;
      this.update({ interimTranscript: this.utteranceBuffer.trim(), isUserSpeaking: true });
    }
    if (this.utteranceTimer !== null) window.clearTimeout(this.utteranceTimer);
    this.utteranceTimer = null;
    if (finished) {
      this.flushUtterance();
      return;
    }
    this.utteranceTimer = window.setTimeout(() => {
      this.utteranceTimer = null;
      this.flushUtterance();
    }, UTTERANCE_SETTLE_MS);
  }

  private flushUtterance() {
    const transcript = this.utteranceBuffer.replace(/\s+/g, ' ').trim();
    this.utteranceBuffer = '';
    if (!transcript) {
      if (this.state.isUserSpeaking) this.update({ isUserSpeaking: false, interimTranscript: '' });
      return;
    }
    this.update({ lastTranscript: transcript, interimTranscript: '', isUserSpeaking: false });
    this.transcriptListeners.forEach(listener => listener(transcript));
  }

  /** Proactive reconnect (session expiry) that keeps the microphone stream open. */
  private async rotateSocket() {
    if (!this.goAwayPending || !this.state.isEnabled) return;
    this.goAwayPending = false;
    const requestId = ++this.startRequestId;
    this.closeSocket();
    this.update({ connection: 'reconnecting' });
    try {
      await this.openSocket(requestId);
      if (requestId !== this.startRequestId) return;
      this.update({ connection: 'ready', errorMessage: null });
    } catch {
      if (requestId !== this.startRequestId) return;
      this.scheduleReconnect('The live host session expired.');
    }
  }

  private markOutput() {
    const pending = this.pendingTurns[0];
    if (pending) pending.sawOutput = true;
  }

  /** Resolve the oldest pending turn once its audio has drained. */
  private completeTurn(reason: 'complete' | 'interrupted') {
    const pending = this.pendingTurns[0];
    if (!pending) {
      this.update({ isOutputting: false, outputTranscript: '', completedTurns: this.state.completedTurns + 1 });
      return;
    }
    const elapsed = performance.now() - pending.sentAt;
    // A completion without any output shortly after sending belongs to the turn we just interrupted.
    if (!pending.sawOutput && elapsed < 2500) return;
    this.pendingTurns.shift();
    const context = audioBus.getContext();
    const remainingMs = context && reason === 'complete' ? Math.max(0, (this.nextPlaybackTime - context.currentTime) * 1000) : 0;
    const finish = () => {
      this.update({ isOutputting: false, outputTranscript: '', completedTurns: this.state.completedTurns + 1 });
      this.turnListeners.forEach(listener => listener({ turnId: pending.id, reason }));
      if (this.goAwayPending && !this.pendingTurns.length) void this.rotateSocket();
    };
    if (remainingMs > 30) {
      if (this.drainTimer !== null) window.clearTimeout(this.drainTimer);
      this.drainTimer = window.setTimeout(() => {
        this.drainTimer = null;
        finish();
      }, remainingMs + 60);
    } else {
      finish();
    }
  }

  // ------------------------------------------------------------------ audio
  private playAudio(base64: string, sampleRate: number) {
    if (this.muted) return;
    const context = audioBus.getContext();
    const bus = audioBus.bus('voice');
    if (!context || !bus) return;
    try {
      const buffer = audioBus.pcm16ToBuffer(base64, sampleRate);
      if (!buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bus);
      this.scheduled.add(source);
      source.onended = () => this.scheduled.delete(source);
      const lead = this.nextPlaybackTime > context.currentTime ? 0.03 : JITTER_BUFFER_S;
      const startAt = Math.max(context.currentTime + lead, this.nextPlaybackTime);
      source.start(startAt);
      this.nextPlaybackTime = startAt + buffer.duration;
      if (context.state === 'suspended') void context.resume();
      if (!this.state.isOutputting) this.update({ isOutputting: true });
    } catch (error) {
      this.update({ errorMessage: error instanceof Error ? `Could not play live host audio: ${error.message}` : 'Could not play live host audio.' });
    }
  }

  private stopScheduledAudio() {
    this.scheduled.forEach(source => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // not started yet
      }
    });
    this.scheduled.clear();
    this.nextPlaybackTime = 0;
    if (this.drainTimer !== null) {
      window.clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private update(changes: Partial<LiveVoiceState>) {
    this.state = { ...this.state, ...changes };
    const snapshot = this.getState();
    queueMicrotask(() => this.listeners.forEach(listener => listener(snapshot)));
  }
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export const liveVoice = new LiveVoiceEngine();
