import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import dotenv from 'dotenv';

dotenv.config();

export type ServerMode = 'live' | 'mock';
export type ClipProviderName = 'preview' | 'local' | 'itunes' | 'deezer' | 'ytdlp' | 'mock';
export type ClipAnalysisMode = 'auto' | 'gemini' | 'loudness';

function findOnPath(binary: string): string | null {
  const candidates = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    for (const name of [binary, `${binary}.exe`]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function parseProviders(value: string | undefined, fallback: ClipProviderName[]): ClipProviderName[] {
  if (!value) return fallback;
  const allowed = new Set<ClipProviderName>(['preview', 'local', 'itunes', 'deezer', 'ytdlp', 'mock']);
  const parsed = value.split(',').map(entry => entry.trim().toLowerCase()).filter((entry): entry is ClipProviderName => allowed.has(entry as ClipProviderName));
  return parsed.length ? parsed : fallback;
}

const mode: ServerMode = process.env.PARTY_HOST_MODE === 'mock' ? 'mock' : 'live';
const apiKey = mode === 'mock' ? '' : (process.env.GEMINI_API_KEY || '');

export const config = {
  mode,
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',
  apiKey,
  hasGemini: Boolean(apiKey),
  models: {
    text: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
    live: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    tts: process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
  },
  hostVoice: process.env.HOST_VOICE || 'Kore',
  cacheDir: resolve(process.env.PARTY_HOST_CACHE_DIR || '.cache'),
  ffmpegPath: process.env.FFMPEG_PATH || findOnPath('ffmpeg'),
  ffprobePath: process.env.FFPROBE_PATH || findOnPath('ffprobe'),
  ytdlpPath: mode === 'mock' ? null : process.env.YTDLP_PATH || findOnPath('yt-dlp'),
  /**
   * Provider order. Songs default to licensed 30-second preview catalogs
   * (fast, reliable, no scraping); yt-dlp is opt-in via CLIP_PROVIDERS.
   */
  // Mock mode must be deterministic regardless of what the developer's .env says.
  songProviders: mode === 'mock' ? (['mock'] as ClipProviderName[]) : parseProviders(process.env.CLIP_PROVIDERS, ['itunes', 'deezer']),
  /** auto = Gemini only for full-length sources; previews use the local loudness scan (sub-second). */
  clipAnalysis: ((['auto', 'gemini', 'loudness'] as ClipAnalysisMode[]).includes(process.env.CLIP_ANALYSIS as ClipAnalysisMode) ? process.env.CLIP_ANALYSIS : 'auto') as ClipAnalysisMode,
  clipConcurrency: Math.max(1, Number(process.env.CLIP_CONCURRENCY || 4)),
  prewarmBuiltins: process.env.PREWARM_BUILTIN_PACKS !== 'false' && mode !== 'mock',
  /** Themes whose packs and clips are built at launch (and after media settings change). */
  prebuildThemes: (process.env.PREBUILD_THEMES || 'The 80s,The 90s,Pop,Rock,Hip Hop,Country').split(',').map(theme => theme.trim()).filter(Boolean),
  /** In mock mode the local library starts empty (tests configure it explicitly) and never calls catalogs. */
  ignoreEnvMedia: mode === 'mock',
  maxClipSeconds: 8,
  maxSourceSeconds: Number(process.env.CLIP_MAX_SOURCE_SECONDS || 720),
  fetchTimeoutMs: Number(process.env.CLIP_FETCH_TIMEOUT_MS || 20_000),
  ytdlpTimeoutMs: Number(process.env.YTDLP_TIMEOUT_MS || 90_000),
  hostStyle:
    'A quick-witted, funny, sarcastic game-show host talking to friends in the same room. Dry punchlines, brisk pacing, varied pitch, crisp natural diction, playful confidence. Tease the game, never the players personally; never shout or sound like a commercial.',
};

export function describeCapabilities() {
  return {
    mode: config.mode,
    hasApiKey: config.hasGemini,
    ffmpeg: Boolean(config.ffmpegPath),
    ytdlp: Boolean(config.ytdlpPath),
    songProviders: config.songProviders,
    clipAnalysis: config.clipAnalysis,
    models: config.models,
  };
}
