import { EndSensitivity, Modality, StartSensitivity, type GoogleGenAI } from '@google/genai';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.ts';
import { gemini } from './gemini.ts';

/**
 * WebSocket proxy between the browser and the Gemini Live API.
 *
 * The browser never sees the API key. It streams 16 kHz PCM up and receives
 * transcripts + 24 kHz PCM audio down. Host lines are sent as tagged text
 * turns ([SAY] verbatim, [IMPROV] directed riff) so the game controller stays
 * in charge of rules and scoring while the live model supplies the voice.
 *
 * In mock mode (PARTY_HOST_MODE=mock) a deterministic fake session is used so
 * the whole game can be exercised end-to-end without network access.
 */
type LiveSession = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;

interface ClientMessage {
  type?: string;
  data?: string;
  text?: string;
  theme?: string;
  mode?: 'say' | 'improv';
}

export function buildHostInstruction(theme: string | undefined) {
  const topic = theme?.trim() ? `a ${theme.trim()} Name That Tune party game` : 'a Name That Tune party game';
  return `You are the funny, sarcastic, quick-witted host of ${topic}, talking to friends in the same room. Speak briskly with dry punchlines and playful confidence; tease the game, never the people. Keep every turn short.

The game controller sends you tagged text:
- "[SAY] ..." : perform that line essentially verbatim. You may add a tiny interjection, but never change names, numbers, answers, or instructions.
- "[IMPROV] ..." : follow the direction in your own words in at most three sentences, keeping every fact on the fact sheet exact.
- A line may start with metadata such as [CONTEXT theme="..."]; adopt it silently and never read metadata aloud.
Everything you hear on the microphone is the players speaking to the game, not to you: never answer questions, never judge answers, never announce scores or move the game along on your own. If you hear players talking, stay silent and wait for the controller. Never invent game state, rules, or facts.`;
}

function send(socket: WebSocket, event: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

interface HostSession {
  sendAudio(base64: string): void;
  sendText(text: string, mode: 'say' | 'improv'): void;
  injectTranscript?(text: string): void;
  close(): void;
}

async function connectGemini(socket: WebSocket, theme: string | undefined): Promise<HostSession> {
  const ai = gemini();
  if (!ai) throw new Error('Live host unavailable: configure GEMINI_API_KEY on the server.');
  const session: LiveSession = await ai.live.connect({
    model: config.models.live,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.hostVoice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Party rooms are noisy: require clearer speech onsets and longer pauses before
      // committing an utterance, so breathing and cross-talk do not become "answers".
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
          prefixPaddingMs: 250,
          silenceDurationMs: 900,
        },
      },
      // Keep long games alive: the session context is compressed instead of the socket dying.
      contextWindowCompression: { slidingWindow: {} },
      systemInstruction: buildHostInstruction(theme),
    },
    callbacks: {
      onmessage: message => {
        if (message.goAway) {
          send(socket, { type: 'go_away', timeLeft: message.goAway.timeLeft ?? null });
        }
        const content = message.serverContent;
        // Input transcription arrives in fragments; the client assembles them until `finished`.
        if (content?.inputTranscription?.text || content?.inputTranscription?.finished) {
          send(socket, { type: 'input_transcript', text: content.inputTranscription.text ?? '', finished: Boolean(content.inputTranscription.finished) });
        }
        if (content?.interimInputTranscription?.text) send(socket, { type: 'interim_transcript', text: content.interimInputTranscription.text });
        if (content?.outputTranscription?.text) send(socket, { type: 'output_transcript', text: content.outputTranscription.text });
        for (const part of content?.modelTurn?.parts ?? []) {
          const audio = part.inlineData;
          if (!audio?.data) continue;
          const rate = audio.mimeType?.match(/rate=(\d+)/)?.[1];
          send(socket, { type: 'audio', data: audio.data, sampleRate: rate ? Number(rate) : 24000 });
        }
        if (content?.interrupted) send(socket, { type: 'interrupted' });
        if (content?.turnComplete) send(socket, { type: 'turn_complete' });
      },
      onerror: event => {
        console.error('Gemini Live session error:', event.message);
        send(socket, { type: 'error', message: 'The Gemini Live host encountered an error.', fatal: true });
        socket.close(1011, 'Gemini Live session error');
      },
      onclose: event => {
        if (socket.readyState === WebSocket.OPEN) {
          console.warn('Gemini Live session closed:', event.code, event.reason);
          send(socket, { type: 'error', message: 'The Gemini Live host disconnected.', fatal: true });
          socket.close(1011, 'Gemini Live session closed');
        }
      },
    },
  });
  return {
    sendAudio: data => session.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }),
    sendText: (text, mode) => session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: `${mode === 'improv' ? '[IMPROV]' : '[SAY]'} ${text}` }] }],
      turnComplete: true,
    }),
    close: () => session.close(),
  };
}

/** Deterministic stand-in for Gemini Live used by tests and offline demos. */
function createMockSession(socket: WebSocket): HostSession {
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  return {
    sendAudio: () => undefined,
    sendText: (text, mode) => {
      const stripped = text.replace(/^\[CONTEXT[^\]]*\]\s*/i, '');
      const spoken = mode === 'improv' ? (stripped.match(/Scripted fallback: "([\s\S]*)"$/)?.[1] ?? stripped) : stripped;
      const words = spoken.split(/\s+/).filter(Boolean).length;
      const duration = Math.min(900, 80 + words * 12);
      later(20, () => send(socket, { type: 'output_transcript', text: spoken }));
      later(duration, () => send(socket, { type: 'turn_complete' }));
    },
    injectTranscript: text => {
      // Mirror the real API: fragments followed by a finished marker.
      const words = text.split(' ');
      const head = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      const tail = words.slice(Math.ceil(words.length / 2)).join(' ');
      later(10, () => send(socket, { type: 'interim_transcript', text: head }));
      later(20, () => send(socket, { type: 'input_transcript', text: head, finished: false }));
      if (tail) later(40, () => send(socket, { type: 'input_transcript', text: ` ${tail}`, finished: false }));
      later(60, () => send(socket, { type: 'input_transcript', text: '', finished: true }));
    },
    close: () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    },
  };
}

export function createLiveServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  wss.on('connection', socket => {
    let session: HostSession | null = null;
    let starting = false;

    const start = async (theme?: string) => {
      if (starting) return;
      if (session) {
        session.close();
        session = null;
      }
      starting = true;
      try {
        session = config.mode === 'mock' ? createMockSession(socket) : await connectGemini(socket, theme);
        if (socket.readyState !== WebSocket.OPEN) {
          session.close();
          session = null;
          return;
        }
        send(socket, { type: 'ready', mode: config.mode, theme: theme ?? null });
      } catch (error) {
        console.error('Could not connect the live host:', error instanceof Error ? error.message : error);
        send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Could not connect to Gemini Live.', fatal: true });
      } finally {
        starting = false;
      }
    };

    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        send(socket, { type: 'error', message: 'Binary client messages are not supported.' });
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(payload.toString()) as ClientMessage;
      } catch {
        send(socket, { type: 'error', message: 'Invalid live voice message.' });
        return;
      }
      switch (message.type) {
        case 'start':
          void start(typeof message.theme === 'string' ? message.theme.slice(0, 80) : undefined);
          return;
        case 'stop':
          session?.close();
          session = null;
          return;
        case 'audio':
          if (session && typeof message.data === 'string' && message.data.length <= 24_000) session.sendAudio(message.data);
          return;
        case 'text':
          if (session && typeof message.text === 'string' && message.text.trim() && message.text.length <= 2000) {
            session.sendText(message.text.trim(), message.mode === 'improv' ? 'improv' : 'say');
          }
          return;
        case 'debug_transcript':
          if (session?.injectTranscript && typeof message.text === 'string') session.injectTranscript(message.text.slice(0, 500));
          else send(socket, { type: 'error', message: 'Transcript injection is only available in mock mode.' });
          return;
        default:
          send(socket, { type: 'error', message: 'Invalid live voice message.' });
      }
    });

    socket.on('close', () => {
      session?.close();
      session = null;
    });
    socket.on('error', error => {
      console.error('Live voice WebSocket error:', error);
      session?.close();
      session = null;
    });
  });

  return wss;
}

/** Only same-origin browsers may open the live socket. */
export function isAllowedUpgrade(request: IncomingMessage) {
  const host = request.headers.host;
  const origin = request.headers.origin;
  if (!host || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function handleUpgrade(wss: WebSocketServer, request: IncomingMessage, socket: Duplex, head: Buffer) {
  let pathname = '';
  try {
    pathname = new URL(request.url ?? '/', `http://${request.headers.host || 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/live' || !isAllowedUpgrade(request)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, upgraded => wss.emit('connection', upgraded, request));
}
