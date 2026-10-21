export interface LiveVoiceState {
  isListening: boolean;
  isEnabled: boolean;
  isPlaybackSuppressed: boolean;
  isSupported: boolean;
  lastTranscript: string;
  outputTranscript: string;
  isSpeaking: boolean;
  isOutputting: boolean;
  errorMessage: string | null;
  completedTurns: number;
}

type LiveVoiceListener = (state: LiveVoiceState) => void;
type TranscriptListener = (transcript: string) => void;

class LiveVoiceEngine {
  private state: LiveVoiceState = {
    isListening: false,
    isEnabled: false,
    isPlaybackSuppressed: false,
    isSupported: typeof window !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof AudioWorkletNode !== 'undefined'
      && typeof WebSocket !== 'undefined',
    lastTranscript: '',
    outputTranscript: '',
    isSpeaking: false,
    isOutputting: false,
    errorMessage: null,
    completedTurns: 0,
  };
  private listeners: LiveVoiceListener[] = [];
  private transcriptListeners: TranscriptListener[] = [];
  private playbackSuppressionSources = new Set<string>();
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private microphone: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private scheduledSources = new Set<AudioBufferSourceNode>();
  private nextPlaybackTime = 0;
  private isMuted = false;
  private startRequestId = 0;

  public getState() {
    return { ...this.state };
  }

  public subscribe(listener: LiveVoiceListener) {
    this.listeners.push(listener);
    queueMicrotask(() => listener(this.getState()));
    return () => {
      this.listeners = this.listeners.filter(existing => existing !== listener);
    };
  }

  public onTranscript(listener: TranscriptListener) {
    this.transcriptListeners.push(listener);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter(existing => existing !== listener);
    };
  }

  public async start(): Promise<boolean> {
    if (this.state.isEnabled) return this.state.isListening;
    if (!this.state.isSupported) {
      this.update({ errorMessage: 'Live voice requires a supported browser with microphone access.' });
      return false;
    }

    const requestId = ++this.startRequestId;
    this.update({ isEnabled: true, errorMessage: null, lastTranscript: '' });
    try {
      const socket = new WebSocket(this.getSocketUrl());
      this.socket = socket;
      await this.waitUntilReady(socket);
      if (requestId !== this.startRequestId) return false;

      const context = new AudioContext({ sampleRate: 16000 });
      this.audioContext = context;
      await context.audioWorklet.addModule('/audio/live-pcm-processor.js');
      if (requestId !== this.startRequestId) return false;
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (requestId !== this.startRequestId) {
        microphone.getTracks().forEach(track => track.stop());
        return false;
      }
      this.microphone = microphone;
      if (context.state === 'suspended') await context.resume();
      if (requestId !== this.startRequestId) return false;

      this.audioSource = context.createMediaStreamSource(this.microphone);
      this.worklet = new AudioWorkletNode(context, 'live-pcm-capture');
      this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (
          socket.readyState !== WebSocket.OPEN
          || this.state.isPlaybackSuppressed
          || !(event.data instanceof ArrayBuffer)
        ) return;
        socket.send(JSON.stringify({ type: 'audio', data: this.toBase64(event.data) }));
      };
      this.audioSource.connect(this.worklet);
      this.worklet.connect(context.destination);
      this.update({ isListening: true });
      return true;
    } catch (error) {
      if (requestId !== this.startRequestId) return false;
      this.update({
        errorMessage: error instanceof Error ? error.message : 'Could not start live voice.',
      });
      this.stop();
      return false;
    }
  }

  public stop() {
    this.startRequestId++;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
      socket.close();
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.audioSource?.disconnect();
    this.microphone?.getTracks().forEach(track => track.stop());
    this.worklet = null;
    this.audioSource = null;
    this.microphone = null;
    if (this.audioContext) void this.audioContext.close();
    this.audioContext = null;
    this.stopScheduledAudio();
    this.playbackSuppressionSources.clear();
    this.update({
      isEnabled: false,
      isListening: false,
      isPlaybackSuppressed: false,
      isSpeaking: false,
      isOutputting: false,
      outputTranscript: '',
    });
  }

  public sendText(text: string) {
    if (!text.trim() || this.socket?.readyState !== WebSocket.OPEN || !this.state.isListening) {
      return false;
    }
    this.socket.send(JSON.stringify({ type: 'text', text: text.trim() }));
    return true;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) this.stopScheduledAudio();
  }

  public setPlaybackSuppressed(source: string, suppressed: boolean) {
    if (suppressed) {
      this.playbackSuppressionSources.add(source);
    } else {
      this.playbackSuppressionSources.delete(source);
    }
    const isPlaybackSuppressed = this.playbackSuppressionSources.size > 0;
    if (this.state.isPlaybackSuppressed !== isPlaybackSuppressed) {
      this.update({ isPlaybackSuppressed });
    }
  }

  private getSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/live`;
  }

  private waitUntilReady(socket: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out connecting to the live host.'));
      }, 20000);

      const finish = (error?: Error) => {
        window.clearTimeout(timeout);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
        if (error) reject(error);
        else resolve();
      };
      const onMessage = (event: MessageEvent<string>) => {
        let message: LiveServerEvent;
        try {
          message = JSON.parse(event.data) as LiveServerEvent;
        } catch {
          finish(new Error('The live host sent an invalid response.'));
          return;
        }
        if (message.type === 'ready') {
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
        socket.send(JSON.stringify({ type: 'start' }));
      }, { once: true });
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  private handleMessage = (event: MessageEvent<string>) => {
    let message: LiveServerEvent;
    try {
      message = JSON.parse(event.data) as LiveServerEvent;
    } catch {
      this.update({ errorMessage: 'The live host sent an invalid response.' });
      return;
    }

    switch (message.type) {
      case 'input_transcript':
        {
          const transcript = message.text?.trim();
          if (!transcript) break;
          this.update({ lastTranscript: transcript, isSpeaking: false });
          this.transcriptListeners.forEach(listener => listener(transcript));
        }
        break;
      case 'interim_transcript':
        this.update({ lastTranscript: message.text?.trim() || '', isSpeaking: !!message.text?.trim() });
        break;
      case 'output_transcript':
        this.update({
          outputTranscript: message.text?.trim() || this.state.outputTranscript,
          isOutputting: true,
        });
        break;
      case 'audio':
        if (message.data) this.playAudio(message.data, message.sampleRate || 24000);
        break;
      case 'interrupted':
        this.stopScheduledAudio();
        this.update({ isOutputting: false, outputTranscript: '' });
        break;
      case 'turn_complete':
        this.update({
          isOutputting: false,
          outputTranscript: '',
          completedTurns: this.state.completedTurns + 1,
        });
        break;
      case 'error':
        this.update({ errorMessage: message.message || 'Live host error.' });
        break;
      default:
        break;
    }
  };

  private handleSocketClose = () => {
    if (!this.socket) return;
    this.update({ errorMessage: 'The Gemini Live connection closed.' });
    this.stop();
  };

  private handleSocketError = () => {
    if (!this.socket) return;
    this.update({ errorMessage: 'The Gemini Live connection failed.' });
    this.stop();
  };

  private async playAudio(base64: string, sampleRate: number) {
    const context = this.audioContext;
    if (!context || this.isMuted) return;
    try {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const sampleCount = Math.floor(bytes.byteLength / 2);
      const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
      const channel = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < sampleCount; index++) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);
      this.scheduledSources.add(source);
      source.onended = () => this.scheduledSources.delete(source);
      const startAt = Math.max(context.currentTime + 0.02, this.nextPlaybackTime);
      source.start(startAt);
      this.nextPlaybackTime = startAt + audioBuffer.duration;
      if (!this.state.isOutputting) this.update({ isOutputting: true });
    } catch (error) {
      this.update({
        errorMessage: error instanceof Error ? `Could not play live host audio: ${error.message}` : 'Could not play live host audio.',
      });
    }
  }

  private stopScheduledAudio() {
    this.scheduledSources.forEach(source => {
      source.onended = null;
      try {
        source.stop();
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') {
          console.warn('Could not stop live host audio:', error);
        }
      }
    });
    this.scheduledSources.clear();
    this.nextPlaybackTime = 0;
  }

  private toBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  private update(changes: Partial<LiveVoiceState>) {
    this.state = { ...this.state, ...changes };
    const snapshot = this.getState();
    queueMicrotask(() => this.listeners.forEach(listener => listener(snapshot)));
  }
}

interface LiveServerEvent {
  type?: string;
  message?: string;
  text?: string;
  data?: string;
  sampleRate?: number;
}

export const liveVoice = new LiveVoiceEngine();
