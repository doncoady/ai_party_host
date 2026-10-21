import express, { Request, Response } from 'express';
import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const liveWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// In-memory audio caches for instantaneous zero-latency playback
const ttsAudioCache = new Map<string, string>();
const quoteAudioCache = new Map<string, string>();
const songClipBufferCache = new Map<string, { buffer: Buffer; contentType: string }>();

// Authentic master recordings directory (official 80s preview streams)
const AUTHENTIC_SONGS: Record<string, { query: string; directUrl: string }> = {
  take_on_me: {
    query: 'a-ha take on me',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f2/03/4f/f2034f41-707f-7111-bc63-e5d3cf7f2240/mzaf_17215043934336702540.plus.aac.p.m4a'
  },
  never_gonna_give_you_up: {
    query: 'rick astley never gonna give you up',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/62/ff/3a/62ff3abe-bc6d-a7d0-31b0-71cbec9aaa24/mzaf_13802296211720217737.plus.aac.p.m4a'
  },
  sweet_dreams: {
    query: 'eurythmics sweet dreams are made of this',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/65/eb/89/65eb89f3-63b5-51d1-84e9-362ddb0259e1/mzaf_13469396206931835946.plus.aac.p.m4a'
  },
  the_final_countdown: {
    query: 'europe the final countdown',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/d3/5b/d9/d35bd9a3-d105-95d8-ba29-0f5c6b8e764b/mzaf_7609183394807520180.plus.aac.p.m4a'
  },
  billie_jean: {
    query: 'michael jackson billie jean',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/dc/bc/8a/dcbc8a3e-4ce1-c00d-cc02-eda2212053c7/mzaf_8347559338388601510.plus.aac.p.m4a'
  },
  blue_monday: {
    query: 'new order blue monday',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/0f/43/1c/0f431c1a-119c-6614-2736-3fbc4c8a597c/mzaf_3646998447648845325.plus.aac.p.m4a'
  },
  dont_you_want_me: {
    query: 'human league dont you want me',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/fb/bd/8f/fbbd8f96-b30d-40f6-c91a-7668330390bb/mzaf_5831637823041295870.plus.aac.p.m4a'
  },
  jump: {
    query: 'van halen jump',
    directUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/89/fa/f1/89faf128-b7de-808a-6893-4fc730dcfbe4/mzaf_10903024022773138434.plus.aac.p.m4a'
  }
};

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY || '';
const DEFAULT_HOST_VOICE = 'Kore';
const LIVE_HOST_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const DEFAULT_HOST_STYLE = 'A quick-witted, funny, sarcastic American game-show host talking to friends in the same room. Use dry punchlines, brisk pacing, varied pitch, crisp natural diction, and playful confidence. Tease the game, never the players personally; do not shout or sound like a commercial.';
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateSpeechAudio(
  text: string,
  style: string = DEFAULT_HOST_STYLE,
  voice: string = DEFAULT_HOST_VOICE
): Promise<string | undefined> {
  if (!ai) return undefined;

  const interaction = await ai.interactions.create({
    model: 'gemini-3.8-flash-tts',
    input: [{
      type: 'user_input',
      content: [{
        type: 'text',
        text,
        annotations: [{ type: 'speech_metadata', style }],
      }],
    }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  });

  return interaction.output_audio?.data;
}

function sendSongClip(req: Request, res: Response, buffer: Buffer, contentType: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');

  const ranges = req.range(buffer.length);
  if (ranges === -1) {
    res.setHeader('Content-Range', `bytes */${buffer.length}`);
    res.status(416).end();
    return;
  }

  if (Array.isArray(ranges) && ranges.length === 1) {
    const { start, end } = ranges[0];
    const partial = buffer.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
    res.setHeader('Content-Length', partial.length);
    res.end(partial);
    return;
  }

  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', hasApiKey: !!apiKey });
});

app.post('/api/host-narrate', async (req: Request, res: Response) => {
  const { isOpening, question, players } = req.body;
  if (
    typeof isOpening !== 'boolean' ||
    !question ||
    typeof question.category !== 'string' ||
    typeof question.title !== 'string' ||
    typeof question.question !== 'string' ||
    typeof question.explanation !== 'string' ||
    !Array.isArray(players) ||
    players.length > 4 ||
    players.some(player => typeof player.name !== 'string' || typeof player.score !== 'number')
  ) {
    return res.status(400).json({ error: 'Invalid narration request' });
  }

  if (!ai) return res.status(503).json({ error: 'AI narration unavailable' });

  try {
    const roster = players.map(player => `${player.name}: $${player.score}`).join(', ');
    const prompt = `Write an original spoken introduction for a live 1980s trivia party-game host.
${isOpening
    ? `Welcome the players (${roster}) to the show and build anticipation for their first category, "${question.category}".`
    : `Introduce the next question in "${question.category}" (${question.title}). Current standings: ${roster}. React naturally to the game so far.`}

Be vivid, conversational, funny, and narrative, like a confident human host talking to friends in a room. Use 2 or 3 short sentences, no more than 45 words. Do not reveal the answer or add facts beyond this context. The game will read the question itself immediately after your intro.
Question: ${question.question}
Verified context: ${question.explanation}
Return only the spoken intro, with no labels or stage directions.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });
    const intro = response.text?.trim();
    if (!intro) return res.status(502).json({ error: 'The host returned no narration' });

    const text = `${intro} ${question.question}`;
    const audioBase64 = await generateSpeechAudio(text);
    res.json({ text, audioBase64 });
  } catch (err) {
    console.error('Error generating host narration:', err);
    res.status(502).json({ error: 'Could not generate host narration' });
  }
});

/**
 * Endpoint: Stream authentic master recording clips from actual songs
 */
app.get('/api/song-clip/:songKey', async (req: Request, res: Response) => {
  const songKey = req.params.songKey?.toLowerCase();
  if (!songKey) return res.status(400).send('Song key required');

  if (songClipBufferCache.has(songKey)) {
    const cached = songClipBufferCache.get(songKey)!;
    return sendSongClip(req, res, cached.buffer, cached.contentType);
  }

  try {
    let targetUrl: string | undefined = AUTHENTIC_SONGS[songKey]?.directUrl;

    if (!targetUrl) {
      // Dynamic fallback search via iTunes search API
      const query = songKey.replace(/_/g, ' ');
      const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
      const searchData = await searchRes.json();
      targetUrl = searchData.results?.[0]?.previewUrl;
    }

    if (!targetUrl) {
      return res.status(404).send('Song clip not found');
    }

    const audioRes = await fetch(targetUrl);
    if (!audioRes.ok) throw new Error(`Audio fetch failed: ${audioRes.status}`);

    const arrayBuf = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const upstreamContentType = audioRes.headers.get('content-type');
    const contentType = upstreamContentType === 'audio/x-m4p'
      ? 'audio/mp4'
      : upstreamContentType || 'audio/mp4';

    songClipBufferCache.set(songKey, { buffer, contentType });

    sendSongClip(req, res, buffer, contentType);
  } catch (err: any) {
    console.error('Error streaming authentic song clip:', err);
    res.status(500).send('Failed to stream song clip');
  }
});

/**
 * Endpoint: Generate natural-sounding host speech using Gemini 3.8 Flash TTS
 * Returns base64 encoded audio/wav
 */
app.post('/api/host-speak', async (req: Request, res: Response) => {
  const { text, voice = DEFAULT_HOST_VOICE, speechStyle = DEFAULT_HOST_STYLE } = req.body;
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
    return res.status(400).json({ error: 'Text must contain between 1 and 1000 characters' });
  }
  if (typeof voice !== 'string' || voice.length > 64 || typeof speechStyle !== 'string' || speechStyle.length > 500) {
    return res.status(400).json({ error: 'Invalid voice settings' });
  }

  const cacheKey = `${voice}_${speechStyle}_${text.trim().toLowerCase()}`;
  if (ttsAudioCache.has(cacheKey)) {
    return res.json({ audioBase64: ttsAudioCache.get(cacheKey), cached: true });
  }

  if (!ai) {
    return res.status(503).json({ error: 'AI unavailable' });
  }

  try {
    const audioBase64 = await generateSpeechAudio(text.trim(), speechStyle, voice);
    if (audioBase64) {
      // Cache audio for repeated game loops
      if (ttsAudioCache.size > 200) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, audioBase64);
      return res.json({ audioBase64, cached: false });
    }

    res.status(502).json({ error: 'The speech model returned no audio' });
  } catch (err: any) {
    console.error('Error generating host TTS:', err);
    res.status(500).json({ error: err.message || 'TTS generation failed' });
  }
});

/**
 * Endpoint: Authentic Character Sound Bytes (Terminator, Doc Brown, Ferris Bueller, etc.)
 */
app.post('/api/character-quote', async (req: Request, res: Response) => {
  const { quoteKey, text, character } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const cacheKey = quoteKey || text;
  if (quoteAudioCache.has(cacheKey)) {
    return res.json({ audioBase64: quoteAudioCache.get(cacheKey), cached: true });
  }

  if (!ai) {
    return res.status(503).json({ error: 'AI unavailable' });
  }

  try {
    // Select voice persona and style
    let voice = 'Puck';
    let style = 'Energetic 80s movie character';

    switch (character?.toLowerCase()) {
      case 'terminator':
      case 'arnold':
        voice = 'Fenrir';
        style = 'Deep robotic deadpan Austrian accent, monotone delivery: I will be back.';
        break;
      case 'doc brown':
      case 'emmett brown':
        voice = 'Zephyr';
        style = 'Eccentric frantic elderly inventor, breathless, excited: Great Scott!';
        break;
      case 'ferris bueller':
        voice = 'Puck';
        style = 'Charismatic, cool, relaxed 80s teenager speaking directly to the audience';
        break;
      case 'mr. t':
      case 'b.a. baracus':
        voice = 'Fenrir';
        style = 'Gruff, booming, aggressive 80s action hero: I pity the fool!';
        break;
      case 'wendy':
      case 'clara peller':
        voice = 'Charon';
        style = 'Loud raspy grandmother yelling angrily: Where is the beef?!';
        break;
      default:
        voice = 'Puck';
        style = 'Authentic dramatic 80s movie dialogue';
    }

    const audioBase64 = await generateSpeechAudio(text.trim(), style, voice);
    if (audioBase64) {
      quoteAudioCache.set(cacheKey, audioBase64);
      return res.json({ audioBase64, cached: false });
    }

    res.status(502).json({ error: 'The speech model returned no audio' });
  } catch (err: any) {
    console.error('Error generating character quote:', err);
    res.status(500).json({ error: err.message || 'Quote generation failed' });
  }
});

// Endpoint: Dynamic host answer commentary with generated audio
app.post('/api/host-roast', async (req: Request, res: Response) => {
  const { playerName, score, questionText, chosenAnswer, isCorrect, correctAnswer, useLiveHost } = req.body;
  if (useLiveHost !== undefined && typeof useLiveHost !== 'boolean') {
    return res.status(400).json({ error: 'Invalid live host option' });
  }

  if (!ai) {
    const fallback = isCorrect
      ? `Boom! ${playerName || 'Player'} nails it with $${score}! Look at you, living in 1985 and loving it!`
      : `Ouch! Minus cash for ${playerName || 'Player'}! That answer was so bad, MTV canceled music videos again!`;
    return res.json({ roast: fallback });
  }

  try {
    const prompt = `You are the witty, quick, warm game show host of an 1980s-themed live trivia party game.
A player named "${playerName || 'Player'}" just answered a question.
Current player bank balance: $${score}.
The question was: "${questionText}".
They picked: "${chosenAnswer}".
Did they get it right? ${isCorrect ? 'YES (CORRECT)' : `NO (WRONG - the real answer was "${correctAnswer}")`}.

Write a sharp, hilarious, energetic 1-2 sentence host quip/roast (maximum 28 words).
- If CORRECT: Congratulate them with smug, sarcastic 80s love.
- If WRONG: Roast them hilariously for their terrible blunder, reminding them of the cash penalty.
Plain text only. No markdown, no stage directions.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const roast = response.text?.trim() || (isCorrect ? 'You got it right! Radical!' : 'Wrong! Total bogus blunder!');

    let audioBase64: string | undefined;
    if (!useLiveHost) {
      try {
        audioBase64 = await generateSpeechAudio(
          roast,
          isCorrect
            ? `${DEFAULT_HOST_STYLE} React with genuine delight and a teasing smile.`
            : `${DEFAULT_HOST_STYLE} React with dry, playful disappointment, never cruel or exaggerated.`
        );
      } catch (ttsError) {
        console.warn('TTS for host roast failed; returning text only:', ttsError);
      }
    }

    res.json({ roast, audioBase64 });
  } catch (error: any) {
    console.error('Error generating host roast:', error);
    const fallback = isCorrect
      ? `Right on the money, ${playerName}! Someone award this player a neon fanny pack!`
      : `Wrong! ${playerName}, that answer was completely bogus. Minus cash for you!`;
    res.json({ roast: fallback });
  }
});

type LiveSession = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;

function sendLiveEvent(socket: WebSocket, event: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

liveWebSocketServer.on('connection', socket => {
  let liveSession: LiveSession | null = null;
  let isStarting = false;

  const startSession = async () => {
    if (isStarting || liveSession) return;
    isStarting = true;
    if (!ai) {
      sendLiveEvent(socket, { type: 'error', message: 'Live host unavailable: configure GEMINI_API_KEY on the server.' });
      isStarting = false;
      return;
    }

    try {
      const session = await ai.live.connect({
        model: LIVE_HOST_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: DEFAULT_HOST_VOICE },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are the funny, sarcastic, quick-witted host of an 1980s trivia party game. Speak briskly, use dry punchlines and playful confidence, and keep teasing friendly rather than cruel. The game controller sends host lines and reactions as text; deliver them naturally. Treat microphone speech as game input, and wait for the controller before judging an answer or announcing a score. Do not invent game state, scores, answers, or rules.`,
        },
        callbacks: {
          onmessage: message => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendLiveEvent(socket, { type: 'input_transcript', text: content.inputTranscription.text });
            }
            if (content?.interimInputTranscription?.text) {
              sendLiveEvent(socket, { type: 'interim_transcript', text: content.interimInputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              sendLiveEvent(socket, { type: 'output_transcript', text: content.outputTranscription.text });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              const audio = part.inlineData;
              if (!audio?.data) continue;
              const rate = audio.mimeType?.match(/rate=(\d+)/)?.[1];
              sendLiveEvent(socket, {
                type: 'audio',
                data: audio.data,
                sampleRate: rate ? Number(rate) : 24000,
              });
            }
            if (content?.interrupted) sendLiveEvent(socket, { type: 'interrupted' });
            if (content?.turnComplete) sendLiveEvent(socket, { type: 'turn_complete' });
          },
          onerror: event => {
            console.error('Gemini Live session error:', event.message);
            sendLiveEvent(socket, { type: 'error', message: 'The Gemini Live host encountered an error.' });
            socket.close(1011, 'Gemini Live session error');
          },
          onclose: event => {
            if (socket.readyState === WebSocket.OPEN) {
              console.warn('Gemini Live session closed:', event.code, event.reason);
              sendLiveEvent(socket, { type: 'error', message: 'The Gemini Live host disconnected.' });
              socket.close(1011, 'Gemini Live session closed');
            }
          },
        },
      });
      if (socket.readyState !== WebSocket.OPEN) {
        session.close();
        return;
      }
      liveSession = session;
      sendLiveEvent(socket, { type: 'ready' });
    } catch (error) {
      console.error('Could not connect Gemini Live host:', error);
      sendLiveEvent(socket, { type: 'error', message: 'Could not connect to Gemini Live. Check the server API key and live model access.' });
    } finally {
      isStarting = false;
    }
  };

  socket.on('message', (payload, isBinary) => {
    if (isBinary) {
      sendLiveEvent(socket, { type: 'error', message: 'Binary client messages are not supported.' });
      return;
    }

    let message: { type?: string; data?: string; text?: string };
    try {
      message = JSON.parse(payload.toString()) as typeof message;
    } catch {
      sendLiveEvent(socket, { type: 'error', message: 'Invalid live voice message.' });
      return;
    }

    if (message.type === 'start') {
      void startSession();
      return;
    }
    if (message.type === 'stop') {
      liveSession?.close();
      liveSession = null;
      return;
    }
    if (!liveSession) return;

    if (message.type === 'audio' && typeof message.data === 'string' && message.data.length <= 10000) {
      liveSession.sendRealtimeInput({
        audio: { data: message.data, mimeType: 'audio/pcm;rate=16000' },
      });
      return;
    }
    if (message.type === 'text' && typeof message.text === 'string' && message.text.trim().length <= 1000) {
      liveSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: message.text.trim() }] }],
        turnComplete: true,
      });
      return;
    }
    sendLiveEvent(socket, { type: 'error', message: 'Invalid live voice message.' });
  });

  socket.on('close', () => {
    liveSession?.close();
    liveSession = null;
  });
  socket.on('error', error => {
    console.error('Live voice WebSocket error:', error);
    liveSession?.close();
    liveSession = null;
  });
});

server.on('upgrade', (request, socket, head) => {
  const host = request.headers.host;
  const origin = request.headers.origin;
  let sameOrigin = false;
  if (host && origin) {
    try {
      sameOrigin = new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  let pathname = '';
  try {
    pathname = new URL(request.url ?? '/', `http://${host || 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/live' || !sameOrigin) {
    socket.destroy();
    return;
  }
  liveWebSocketServer.handleUpgrade(request, socket, head, upgradedSocket => {
    liveWebSocketServer.emit('connection', upgradedSocket, request);
  });
});

// Setup Vite or static serving
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(Number(port), '0.0.0.0', () => {
    console.log(`[80s Trivia Server] Running on http://0.0.0.0:${port}`);
  });
}

startServer();
