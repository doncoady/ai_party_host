import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { config, type ClipProviderName } from '../config.ts';
import { copyFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { renderTestTone } from './ffmpeg.ts';

const execFileAsync = promisify(execFile);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface ClipRequest {
  /** Free-text search query, e.g. "a-ha Take On Me". */
  query: string;
  artist?: string;
  title?: string;
  year?: number;
  /** Direct preview download URL from the catalog lookup (exact track, fresh URL). */
  directUrl?: string;
  /** Path of a file in a configured local collection. */
  localPath?: string;
  targetSeconds: number;
  /** Where to cut: the song's opening (default; rarely sings the title) or the loudest hook. */
  position?: 'start' | 'hook';
}

export interface SourceResult {
  provider: ClipProviderName;
  filePath: string;
  contentType: string;
  title: string;
  sourceUrl?: string;
  uploader?: string;
  durationSeconds?: number;
  /** True for short sources (30-second previews) rather than full tracks. */
  isExcerpt: boolean;
}

export interface ClipProvider {
  name: ClipProviderName;
  fetch(request: ClipRequest, workDir: string): Promise<SourceResult | null>;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
export function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(?:official|video|audio|lyrics?|hd|hq|remaster(?:ed)?|version|feat\.?|ft\.?|the|a|an|of|and)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fraction of query tokens present in the candidate title (0..1). */
export function tokenOverlap(query: string, candidate: string) {
  const wanted = normalizeForCompare(query).split(' ').filter(Boolean);
  if (!wanted.length) return 0;
  const have = new Set(normalizeForCompare(candidate).split(' ').filter(Boolean));
  const hits = wanted.filter(token => have.has(token)).length;
  return hits / wanted.length;
}

async function downloadToFile(url: string, filePath: string, timeoutMs = config.fetchTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': BROWSER_UA } });
    if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filePath));
    return response.headers.get('content-type') || 'application/octet-stream';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, timeoutMs = config.fetchTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 ai-party-host', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
// yt-dlp: search YouTube, pick the best candidate, download audio only.
// --------------------------------------------------------------------------
interface YtdlpEntry {
  id?: string;
  title?: string;
  duration?: number;
  url?: string;
  webpage_url?: string;
  uploader?: string;
  channel?: string;
  view_count?: number;
}

export function rankYoutubeCandidates(entries: YtdlpEntry[], request: ClipRequest): YtdlpEntry[] {
  const query = `${request.artist ?? ''} ${request.title ?? ''}`.trim() || request.query;
  return entries
    .filter(entry => entry && (entry.url || entry.webpage_url || entry.id))
    .map(entry => {
      const title = entry.title ?? '';
      const duration = entry.duration ?? 0;
      let score = tokenOverlap(query, title) * 10;
      const lower = title.toLowerCase();
      if (/official (?:audio|video|music video)|topic|\bhq\b|\bhd\b/.test(lower) || /topic$/i.test(entry.uploader ?? entry.channel ?? '')) score += 2;
      if (/live|cover|karaoke|instrumental|remix|reaction|tutorial|lesson|slowed|sped up|nightcore|8d|hour/.test(lower)) score -= 6;
      if (duration && (duration < 60 || duration > config.maxSourceSeconds)) score -= 8;
      if (duration && duration >= 120 && duration <= 420) score += 1;
      if (entry.view_count) score += Math.min(2, Math.log10(entry.view_count) / 4);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.entry);
}

async function ytdlpSearch(query: string, count: number): Promise<YtdlpEntry[]> {
  if (!config.ytdlpPath) return [];
  const { stdout } = await execFileAsync(config.ytdlpPath, [
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    '--skip-download',
    `ytsearch${count}:${query}`,
  ], { timeout: config.ytdlpTimeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { entries?: YtdlpEntry[] };
  return parsed.entries ?? [];
}

async function ytdlpDownload(url: string, workDir: string): Promise<{ filePath: string; info: YtdlpEntry }> {
  if (!config.ytdlpPath) throw new Error('yt-dlp is not installed');
  const template = join(workDir, 'source.%(ext)s');
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--format', 'bestaudio[ext=m4a]/bestaudio/best',
    '--match-filter', `duration <= ${config.maxSourceSeconds}`,
    '--print-json',
    '-o', template,
    url,
  ];
  if (config.ffmpegPath) args.push('--ffmpeg-location', config.ffmpegPath, '--extract-audio', '--audio-format', 'm4a', '--audio-quality', '5');
  const { stdout } = await execFileAsync(config.ytdlpPath, args, { timeout: config.ytdlpTimeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const info = JSON.parse(stdout.split('\n').find(line => line.trim().startsWith('{')) ?? '{}') as YtdlpEntry;
  const files = await readdir(workDir);
  const downloaded = files.find(file => file.startsWith('source.'));
  if (!downloaded) throw new Error('yt-dlp produced no file');
  return { filePath: join(workDir, downloaded), info };
}

/** Full-length tracks via YouTube (opt-in): the only online source that contains the real song intro. */
export const ytdlpProvider: ClipProvider = {
  name: 'ytdlp',
  async fetch(request, workDir) {
    if (!config.ytdlpPath) return null;
    const searchQuery = `${request.artist ?? ''} ${request.title ?? ''} official audio`.trim();
    const entries = rankYoutubeCandidates(await ytdlpSearch(searchQuery, 5), request);
    const best = entries[0];
    if (!best) return null;
    if (tokenOverlap(`${request.artist ?? ''} ${request.title ?? ''}`, best.title ?? '') < 0.5) return null;
    const target = best.webpage_url ?? best.url ?? `https://www.youtube.com/watch?v=${best.id}`;
    const { filePath, info } = await ytdlpDownload(target, workDir);
    return {
      provider: 'ytdlp',
      filePath,
      contentType: filePath.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm',
      title: info.title ?? best.title ?? request.query,
      sourceUrl: target,
      uploader: info.uploader ?? info.channel ?? best.uploader,
      durationSeconds: info.duration ?? best.duration,
      isExcerpt: false,
    };
  },
};

// --------------------------------------------------------------------------
// iTunes Search API: licensed 30-second preview streams.
// --------------------------------------------------------------------------
interface ItunesResult {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
}

export function rankItunes(results: ItunesResult[], request: ClipRequest) {
  return results
    .filter(result => result.previewUrl)
    .map(result => ({
      result,
      score: tokenOverlap(request.title ?? request.query, result.trackName ?? '') * 2 + tokenOverlap(request.artist ?? '', result.artistName ?? ''),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Apple's Search API returns fresh 30-second preview streams (AAC). These are
 * licensed previews and the fastest reliable song source, so they come first.
 */
export const itunesProvider: ClipProvider = {
  name: 'itunes',
  async fetch(request, workDir) {
    const filePath = join(workDir, 'source.m4a');
    const term = `${request.artist ?? ''} ${request.title ?? request.query}`.trim();
    let previewUrl: string | undefined;
    let title = `${request.artist ?? ''} - ${request.title ?? request.query}`.replace(/^ - /, '');
    let sourceUrl: string | undefined;
    try {
      const data = await fetchJson<{ results?: ItunesResult[] }>(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`);
      const best = rankItunes(data.results ?? [], request)[0];
      if (best && best.score >= 1) {
        previewUrl = best.result.previewUrl!;
        title = `${best.result.artistName} - ${best.result.trackName}`;
        sourceUrl = best.result.trackViewUrl;
      }
    } catch (error) {
      if (!request.directUrl) throw error;
    }
    // Curated packs may pin a preview URL; use it only when the search found nothing.
    if (!previewUrl && request.directUrl) previewUrl = request.directUrl;
    if (!previewUrl) return null;
    const contentType = await downloadToFile(previewUrl, filePath);
    return {
      provider: 'itunes',
      filePath,
      contentType: contentType === 'audio/x-m4p' || !contentType.startsWith('audio/') ? 'audio/mp4' : contentType,
      title,
      sourceUrl: sourceUrl ?? previewUrl,
      durationSeconds: 30,
      isExcerpt: true,
    };
  },
};

// --------------------------------------------------------------------------
// Deezer: public search API with 30-second MP3 previews, no key required.
// --------------------------------------------------------------------------
interface DeezerResult {
  title?: string;
  preview?: string;
  link?: string;
  artist?: { name?: string };
  duration?: number;
}

export function rankDeezer(results: DeezerResult[], request: ClipRequest) {
  return results
    .filter(result => result.preview)
    .map(result => ({
      result,
      score: tokenOverlap(request.title ?? request.query, result.title ?? '') * 2 + tokenOverlap(request.artist ?? '', result.artist?.name ?? ''),
    }))
    .sort((a, b) => b.score - a.score);
}

export const deezerProvider: ClipProvider = {
  name: 'deezer',
  async fetch(request, workDir) {
    const query = request.artist && request.title
      ? `artist:"${request.artist}" track:"${request.title}"`
      : request.query;
    let results: DeezerResult[] = [];
    const data = await fetchJson<{ data?: DeezerResult[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`);
    results = data.data ?? [];
    if (!results.length && request.artist && request.title) {
      const loose = await fetchJson<{ data?: DeezerResult[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(`${request.artist} ${request.title}`)}&limit=10`);
      results = loose.data ?? [];
    }
    const best = rankDeezer(results, request)[0];
    if (!best || best.score < 1) return null;
    const filePath = join(workDir, 'source.mp3');
    const contentType = await downloadToFile(best.result.preview!, filePath);
    return {
      provider: 'deezer',
      filePath,
      contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg',
      title: `${best.result.artist?.name ?? ''} - ${best.result.title ?? ''}`,
      sourceUrl: best.result.link ?? best.result.preview,
      durationSeconds: 30,
      isExcerpt: true,
    };
  },
};

// --------------------------------------------------------------------------
// Exact-track providers: a catalog preview URL or a local file, no searching.
// --------------------------------------------------------------------------
export const previewProvider: ClipProvider = {
  name: 'preview',
  async fetch(request, workDir) {
    if (!request.directUrl) return null;
    const extension = request.directUrl.includes('.m4a') || request.directUrl.includes('aac') ? 'm4a' : 'mp3';
    const filePath = join(workDir, `source.${extension}`);
    const contentType = await downloadToFile(request.directUrl, filePath);
    return {
      provider: 'preview',
      filePath,
      contentType: contentType === 'audio/x-m4p' || !contentType.startsWith('audio/') ? (extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg') : contentType,
      title: `${request.artist ?? ''} - ${request.title ?? request.query}`.replace(/^ - /, ''),
      sourceUrl: request.directUrl,
      durationSeconds: 30,
      isExcerpt: true,
    };
  },
};

export const localProvider: ClipProvider = {
  name: 'local',
  async fetch(request, workDir) {
    if (!request.localPath) return null;
    const extension = extname(request.localPath).toLowerCase() || '.mp3';
    const filePath = join(workDir, `source${extension}`);
    await copyFile(request.localPath, filePath);
    const contentType = extension === '.m4a' || extension === '.aac' ? 'audio/mp4' : extension === '.wav' ? 'audio/wav' : extension === '.flac' ? 'audio/flac' : extension.startsWith('.og') || extension === '.opus' ? 'audio/ogg' : 'audio/mpeg';
    return {
      provider: 'local',
      filePath,
      contentType,
      title: `${request.artist ?? ''} - ${request.title ?? request.query}`.replace(/^ - /, ''),
      sourceUrl: `file://${request.localPath}`,
      // Local songs are full tracks: the clip comes from the real intro.
      isExcerpt: false,
    };
  },
};

// --------------------------------------------------------------------------
// Mock provider: synthesized tone so the full pipeline runs offline / in tests.
// --------------------------------------------------------------------------
export const mockProvider: ClipProvider = {
  name: 'mock',
  async fetch(request, workDir) {
    const filePath = join(workDir, 'source.mp3');
    const seconds = 12;
    const frequency = 330 + (hashString(request.query) % 12) * 40;
    await renderTestTone(filePath, seconds, frequency);
    const info = await stat(filePath);
    if (!info.size) return null;
    return {
      provider: 'mock',
      filePath,
      contentType: 'audio/mpeg',
      title: `Mock song: ${request.query}`,
      sourceUrl: 'mock://tone',
      durationSeconds: seconds,
      isExcerpt: false,
    };
  },
};

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

export const PROVIDERS: Record<ClipProviderName, ClipProvider> = {
  preview: previewProvider,
  local: localProvider,
  itunes: itunesProvider,
  deezer: deezerProvider,
  ytdlp: ytdlpProvider,
  mock: mockProvider,
};
