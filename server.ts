import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', hasApiKey: !!apiKey });
});

/**
 * Endpoint: Stream authentic master recording clips from actual songs
 */
app.get('/api/song-clip/:songKey', async (req: Request, res: Response) => {
  const songKey = req.params.songKey?.toLowerCase();
  if (!songKey) return res.status(400).send('Song key required');

  if (songClipBufferCache.has(songKey)) {
    const cached = songClipBufferCache.get(songKey)!;
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
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
    const contentType = audioRes.headers.get('content-type') || 'audio/mp4';

    songClipBufferCache.set(songKey, { buffer, contentType });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err: any) {
    console.error('Error streaming authentic song clip:', err);
    res.status(500).send('Failed to stream song clip');
  }
});

/**
 * Endpoint: Generate authentic human speech using Gemini 3.8 Flash Lite TTS
 * Returns base64 encoded audio/wav
 */
app.post('/api/host-speak', async (req: Request, res: Response) => {
  const { text, voice = 'Puck', speechStyle } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  const cacheKey = `${voice}_${speechStyle || ''}_${text.trim().toLowerCase()}`;
  if (ttsAudioCache.has(cacheKey)) {
    return res.json({ audioBase64: ttsAudioCache.get(cacheKey), cached: true });
  }

  if (!ai) {
    return res.status(503).json({ error: 'AI unavailable' });
  }

  try {
    const parts: any[] = [{ text: text.trim() }];
    if (speechStyle) {
      parts[0].speechMetadata = { style: speechStyle };
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioBase64) {
      // Cache audio for repeated game loops
      if (ttsAudioCache.size > 200) {
        const firstKey = ttsAudioCache.keys().next().value;
        if (firstKey) ttsAudioCache.delete(firstKey);
      }
      ttsAudioCache.set(cacheKey, audioBase64);
      return res.json({ audioBase64, cached: false });
    }

    res.status(500).json({ error: 'No audio generated' });
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [{
        role: 'user',
        parts: [{
          text: text.trim(),
          speechMetadata: { style }
        }]
      }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioBase64) {
      quoteAudioCache.set(cacheKey, audioBase64);
      return res.json({ audioBase64, cached: false });
    }

    res.status(500).json({ error: 'No audio generated' });
  } catch (err: any) {
    console.error('Error generating character quote:', err);
    res.status(500).json({ error: err.message || 'Quote generation failed' });
  }
});

/**
 * Endpoint: Live Voice Interaction & Banter with the AI Host
 * Players talk live into the microphone!
 * The AI Host analyzes the intent, executes game actions (BUZZ, ANSWER, SCREW, NEXT),
 * and generates authentic sarcastic speech back to the players.
 */
app.post('/api/host-converse', async (req: Request, res: Response) => {
  const { transcript, gameState, players, currentQuestion, activeBuzzerPlayerId } = req.body;

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Transcript required' });
  }

  if (!ai) {
    return res.json({
      intent: 'BANTER',
      hostReplyText: `I heard you, but my AI circuits are resting. Keep playing!`,
    });
  }

  try {
    const prompt = `You are the witty, razor-sharp, sarcastic host of a live 80s party game show called "YOU DON'T KNOW 80s!".
The live players in the living room just spoke to you via their microphone:
Player Voice Input: "${transcript}"

Current Game State: ${gameState}
Current Question: ${currentQuestion ? `"${currentQuestion.question}"` : 'None'}
Options: ${currentQuestion ? JSON.stringify(currentQuestion.options) : 'None'}
Active Buzzer Player: ${activeBuzzerPlayerId || 'None'}
Players in Room: ${JSON.stringify(players.map((p: any) => ({ id: p.id, name: p.name, score: p.score })))}

Analyze what the player in the room is trying to do:
1. BUZZ: Did someone try to buzz in? (e.g. saying their name like "Nancy", "Rick", "I'm in", "Buzz", "Player 1")
2. ANSWER: If a player is buzzed in (or trying to answer), did they say an answer or option number? (e.g. "Ferris Bueller", "A-ha", "Choice B", "Option 1")
3. SCREW: Did someone say "Screw Rick" or "Screw Nancy" or "Use my screw"?
4. START_GAME: In the lobby, did someone say "Start game", "Let's play", "Go"?
5. NEXT_QUESTION: Did someone say "Next question", "Keep going", "Let's move on"?
6. BANTER: Are they talking to you, joking, asking a question, complaining, or asking for a hint?

Return valid JSON strictly matching this schema:
{
  "intent": "BUZZ" | "ANSWER" | "SCREW" | "START_GAME" | "NEXT_QUESTION" | "BANTER",
  "playerId": string or null (if intent is BUZZ or player identified),
  "optionIndex": number or null (0-3 if intent is ANSWER),
  "targetPlayerId": string or null (if intent is SCREW),
  "hostReplyText": string (hilarious, sarcastic 1-2 sentence spoken reply, max 30 words. Plain text only, no markdown or asterisks),
  "speechStyle": string (e.g. "Sarcastic punchy game show host" or "Mocking comedic tease")
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const hostReplyText = parsed.hostReplyText || "Alright, let's keep the 80s moving!";

    // Automatically generate authentic Puck TTS voice for the reply
    let audioBase64: string | undefined;
    try {
      const ttsRes = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{
          role: 'user',
          parts: [{ text: hostReplyText }]
        }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
        },
      });
      audioBase64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (ttsErr) {
      console.warn('TTS inside converse failed, falling back to text:', ttsErr);
    }

    res.json({
      ...parsed,
      audioBase64,
    });
  } catch (err: any) {
    console.error('Error in host-converse:', err);
    res.json({
      intent: 'BANTER',
      hostReplyText: "I heard ya! Let's get back to the trivia before my hairspray wears off.",
    });
  }
});

// Endpoint: Dynamic YDKJ AI Host Roast & Commentary (with authentic audio)
app.post('/api/host-roast', async (req: Request, res: Response) => {
  const { playerName, score, questionText, chosenAnswer, isCorrect, correctAnswer } = req.body;

  if (!ai) {
    const fallback = isCorrect
      ? `Boom! ${playerName || 'Player'} nails it with $${score}! Look at you, living in 1985 and loving it!`
      : `Ouch! Minus cash for ${playerName || 'Player'}! That answer was so bad, MTV canceled music videos again!`;
    return res.json({ roast: fallback });
  }

  try {
    const prompt = `You are the legendary, witty, sarcastic game show host of a 1980s themed "You Don't Know Jack" (YDKJ) style live trivia game.
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

    // Generate authentic voice audio for the roast
    let audioBase64: string | undefined;
    try {
      const ttsRes = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{
          role: 'user',
          parts: [{
            text: roast,
            speechMetadata: {
              style: isCorrect ? 'Proud sarcastic comedic host' : 'Mocking sarcastic laughing game show host'
            }
          }]
        }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
        },
      });
      audioBase64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch {
      // Audio optional
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

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[YDKJ 80s Server] Running on http://0.0.0.0:${port}`);
  });
}

startServer();
