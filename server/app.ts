import express, { type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, describeCapabilities } from './config.ts';
import { generateJson, synthesizeSpeech } from './gemini.ts';
import { clipPipeline } from './clips/pipeline.ts';
import { packService, toClipRef } from './packs.ts';
import { localLibrary } from './local.ts';
import type { Difficulty } from '../src/game/types.ts';

/** Bounded LRU-ish cache (insertion order eviction). */
class BoundedCache<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly limit: number) {}
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: T) {
    if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}

const ttsCache = new BoundedCache<string>(400);
const ttsInflight = new Map<string, Promise<string | undefined>>();
const TTS_DIR = join(config.cacheDir, 'tts');
/** At most this many Gemini TTS requests run at once; the rest wait in line rather than tripping the quota. */
const TTS_CONCURRENCY = 2;
let ttsRunning = 0;
const ttsWaiters: Array<() => void> = [];
/** After a 429 we refuse new synthesis until this time and tell clients when to retry. */
let ttsBackoffUntil = 0;

async function withTtsSlot<T>(work: () => Promise<T>): Promise<T> {
  if (ttsRunning >= TTS_CONCURRENCY) await new Promise<void>(resolve => ttsWaiters.push(resolve));
  ttsRunning += 1;
  try {
    return await work();
  } finally {
    ttsRunning -= 1;
    ttsWaiters.shift()?.();
  }
}

function rateLimitInfo(error: unknown): { limited: boolean; retryAfterSeconds: number } {
  const anyError = error as { status?: number; code?: number; message?: string; error?: { code?: number; status?: string } };
  const text = `${anyError?.message ?? ''} ${anyError?.error?.status ?? ''}`;
  const status = anyError?.status ?? anyError?.code ?? anyError?.error?.code;
  const limited = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(text);
  const match = text.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)s/i);
  return { limited, retryAfterSeconds: match ? Math.max(5, Math.ceil(Number(match[1]))) : 30 };
}

async function readTtsDisk(key: string): Promise<string | undefined> {
  const file = join(TTS_DIR, `${createHash('sha1').update(key).digest('hex')}.b64`);
  if (!existsSync(file)) return undefined;
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function writeTtsDisk(key: string, audio: string) {
  try {
    await mkdir(TTS_DIR, { recursive: true });
    await writeFile(join(TTS_DIR, `${createHash('sha1').update(key).digest('hex')}.b64`), audio);
  } catch (error) {
    console.warn('[tts] could not persist render:', error instanceof Error ? error.message : error);
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ...describeCapabilities(), local: localLibrary.status() });
  });

  // ------------------------------------------------------------- settings
  app.get('/api/settings', (_req, res) => {
    res.json(localLibrary.status());
  });

  app.put('/api/settings', async (req, res) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).json({ error: 'Media settings can only be changed from the host machine' });
    }
    const { localSongsDir, preferLocal } = req.body ?? {};
    if ((localSongsDir !== undefined && (typeof localSongsDir !== 'string' || localSongsDir.length > 500))
      || (preferLocal !== undefined && typeof preferLocal !== 'boolean')) {
      return res.status(400).json({ error: 'Invalid media settings' });
    }
    try {
      const status = await localLibrary.updateSettings({ localSongsDir, preferLocal });
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Could not save settings' });
    }
  });

  // ---------------------------------------------------------------- packs
  app.post('/api/theme/pack', async (req: Request, res: Response) => {
    const { theme, difficulty = 'medium', clipSeconds = 3, clipPosition = 'start', exclude = [] } = req.body ?? {};
    if (typeof theme !== 'string' || !theme.trim() || theme.length > 80) return res.status(400).json({ error: 'Theme must be 1-80 characters' });
    if (!['easy', 'medium', 'hard'].includes(difficulty)) return res.status(400).json({ error: 'Invalid difficulty' });
    const seconds = Number(clipSeconds);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > config.maxClipSeconds) return res.status(400).json({ error: 'Invalid clip length' });
    if (!Array.isArray(exclude) || exclude.length > 500 || exclude.some(id => typeof id !== 'string') || !['start', 'hook'].includes(clipPosition)) return res.status(400).json({ error: 'Invalid pack options' });
    try {
      const result = await packService.resolve({ theme: theme.trim(), difficulty: difficulty as Difficulty, clipSeconds: seconds, clipPosition, exclude });
      if (!result) {
        console.warn(`[packs] no pack for "${theme}"`);
        return res.status(404).json({
          error: `No song previews found for "${theme.trim()}". Try a genre, decade, artist or franchise, or configure a local music folder in Settings.`,
          builtinThemes: ['The 80s', 'The 90s'],
        });
      }
      console.log(`[packs] "${theme}" → ${result.origin} (${result.pack.questions.length} questions, ${result.buildMs} ms${result.sources.length ? `, ${result.sources.join(', ')}` : ''})`);
      if (result.warnings.length) console.warn(`[packs] "${theme}" warnings: ${result.warnings.join(' | ')}`);
      res.json(result);
    } catch (error) {
      console.error(`[packs] failed for "${theme}":`, error instanceof Error ? error.message : error);
      res.status(502).json({ error: `Could not build "${theme}": ${error instanceof Error ? error.message : 'unknown error'}` });
    }
  });

  // ---------------------------------------------------------------- clips
  const CLIP_ID = /^[a-f0-9]{16}$/;
  app.param('id', (_req, res, next, id) => {
    if (!CLIP_ID.test(String(id))) return res.status(404).json({ error: 'Unknown clip' });
    next();
  });

  app.get('/api/clips/status', async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map(id => id.trim()).filter(id => CLIP_ID.test(id)).slice(0, 64);
    const records = await clipPipeline.getMany(ids);
    res.json({ clips: records.map(record => toClipRef(record)) });
  });

  app.get('/api/clips/:id/status', async (req, res) => {
    const record = await clipPipeline.get(String(req.params.id));
    if (!record) return res.status(404).json({ error: 'Unknown clip' });
    res.json(toClipRef(record));
  });

  app.get('/api/clips/:id', async (req, res) => {
    const record = await clipPipeline.get(String(req.params.id));
    if (!record) return res.status(404).json({ error: 'Unknown clip' });
    if (record.status === 'pending') {
      res.setHeader('Retry-After', '2');
      return res.status(202).json(toClipRef(record));
    }
    if (record.status === 'failed' || !record.filePath) return res.status(404).json(toClipRef(record));

    const info = await stat(record.filePath).catch(() => null);
    if (!info) return res.status(404).json({ error: 'Clip file missing' });
    res.setHeader('Content-Type', record.contentType ?? 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Clip-Offset', String(record.offsetSeconds));
    res.setHeader('X-Clip-Duration', String(record.durationSeconds ?? ''));

    const ranges = req.range(info.size);
    if (ranges === -1) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      return res.status(416).end();
    }
    if (Array.isArray(ranges) && ranges.length === 1) {
      const { start, end } = ranges[0];
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return createReadStream(record.filePath, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', info.size);
    createReadStream(record.filePath).pipe(res);
  });

  // ---------------------------------------------------------------- judge
  app.post('/api/judge', async (req, res) => {
    const { question, options, correctIndex, transcript } = req.body ?? {};
    if (typeof question !== 'string' || !Array.isArray(options) || options.length !== 4 || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Invalid judge request' });
    }
    if (!config.hasGemini) return res.json({ optionIndex: null, confidence: 0, reason: 'judge unavailable' });
    try {
      const prompt = `A trivia player answered out loud. Decide which option, if any, the spoken answer refers to.
Question: ${question}
Options: ${options.map((option: string, index: number) => `${index}: ${option}`).join(' | ')}
Spoken answer (speech-to-text, may contain errors): "${transcript.slice(0, 300)}"
Return JSON {"optionIndex": number or null, "confidence": 0-1}. Use null unless the spoken answer clearly identifies one option (nicknames, alternate titles, actor names for characters, and misheard spellings count).`;
      const result = await generateJson<{ optionIndex: number | null; confidence: number }>(prompt, {
        type: 'object',
        properties: { optionIndex: { type: 'integer', nullable: true }, confidence: { type: 'number' } },
        required: ['optionIndex', 'confidence'],
      }, { temperature: 0 });
      const index = result && Number.isInteger(result.optionIndex) && result.optionIndex! >= 0 && result.optionIndex! < 4 ? result.optionIndex : null;
      const confidence = Math.min(1, Math.max(0, Number(result?.confidence) || 0));
      res.json({ optionIndex: confidence >= 0.6 ? index : null, confidence });
      void correctIndex;
    } catch (error) {
      console.warn('Judge failed:', error instanceof Error ? error.message : error);
      res.json({ optionIndex: null, confidence: 0 });
    }
  });

  // ---------------------------------------------------------------- speech
  app.post('/api/host-speak', async (req, res) => {
    const { text, voice = config.hostVoice, speechStyle = config.hostStyle } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return res.status(400).json({ error: 'Text must contain between 1 and 1000 characters' });
    if (typeof voice !== 'string' || voice.length > 64 || typeof speechStyle !== 'string' || speechStyle.length > 500) return res.status(400).json({ error: 'Invalid voice settings' });
    const key = `${voice}|${speechStyle}|${text.trim().toLowerCase()}`;
    const cached = ttsCache.get(key) ?? (await readTtsDisk(key));
    if (cached) {
      ttsCache.set(key, cached);
      return res.json({ audioBase64: cached, cached: true });
    }
    if (!config.hasGemini) return res.status(503).json({ error: 'AI speech unavailable' });
    if (Date.now() < ttsBackoffUntil) {
      res.setHeader('Retry-After', String(Math.ceil((ttsBackoffUntil - Date.now()) / 1000)));
      return res.status(429).json({ error: 'Speech synthesis is rate-limited; retry later' });
    }
    try {
      // Identical lines requested at the same moment share one synthesis.
      const job = ttsInflight.get(key) ?? withTtsSlot(() => synthesizeSpeech(text.trim(), speechStyle, voice)).finally(() => ttsInflight.delete(key));
      ttsInflight.set(key, job);
      const audioBase64 = await job;
      if (!audioBase64) return res.status(502).json({ error: 'The speech model returned no audio' });
      ttsCache.set(key, audioBase64);
      void writeTtsDisk(key, audioBase64);
      res.json({ audioBase64, cached: false });
    } catch (error) {
      const { limited, retryAfterSeconds } = rateLimitInfo(error);
      if (limited) {
        ttsBackoffUntil = Date.now() + retryAfterSeconds * 1000;
        console.warn(`[tts] Gemini TTS rate limit hit; pausing synthesis for ${retryAfterSeconds} s (clients fall back to the live host or browser speech).`);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: 'Speech synthesis is rate-limited; retry later' });
      }
      console.error('Host TTS failed:', error instanceof Error ? error.message : error);
      res.status(502).json({ error: 'TTS generation failed' });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
