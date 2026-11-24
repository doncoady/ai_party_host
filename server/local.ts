import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.ts';
import type { CatalogTrack } from './catalog.ts';

const execFileAsync = promisify(execFile);

/**
 * A local music collection as a fallback (or preferred) source.
 *
 *   <LOCAL_SONGS_DIR>/<anything>/Artist - Title.mp3
 *
 * Files are matched to a theme by folder names, ID3 tags (genre, album, year),
 * decade words, and — because tags are often missing or wrong — genres and
 * release years looked up from the Deezer catalog after indexing.
 * The folder is configured in `.env` (LOCAL_SONGS_DIR, PREFER_LOCAL_MEDIA);
 * the Settings drawer reads and writes the same file.
 */
export interface MediaSettings {
  localSongsDir: string;
  preferLocal: boolean;
}

export interface LocalTrack {
  path: string;
  relPath: string;
  artist: string;
  title: string;
  album?: string;
  genre?: string;
  year?: number;
  mtimeMs: number;
  /** Genre/year looked up from the Deezer catalog (tags cannot be trusted to exist or be right). */
  catalogGenres?: string[];
  catalogYear?: number;
  enrichedAt?: number;
}

interface IndexFile {
  version: 3;
  songs: LocalTrack[];
  indexedAt: number;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.wma']);
const MAX_FILES = Number(process.env.LOCAL_LIBRARY_MAX_FILES || 4000);
const ENV_FILE = resolve(process.env.PARTY_HOST_ENV_FILE || '.env');

function settingsFromEnv(): MediaSettings {
  if (config.ignoreEnvMedia) return { localSongsDir: '', preferLocal: false };
  return {
    localSongsDir: process.env.LOCAL_SONGS_DIR || '',
    preferLocal: process.env.PREFER_LOCAL_MEDIA === 'true',
  };
}

/** Inserts or replaces KEY=value lines in the .env file, keeping everything else intact. */
export async function upsertEnv(file: string, values: Record<string, string>) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const index = lines.findIndex(entry => entry.trim().startsWith(`${key}=`) || entry.trim().startsWith(`# ${key}=`));
    if (index === -1) {
      // Append after the last non-empty line.
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(line);
    } else {
      lines[index] = line;
    }
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.join('\n').replace(/\n*$/, '\n'));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Artist - Title (feat. X).mp3" → { artist, title }. Single-part names become the title. */
export function parseSongFilename(file: string): { artist: string; title: string } {
  const stem = basename(file, extname(file)).replace(/^\d{1,3}[\s._-]+/, '').trim();
  const parts = stem.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: stem };
}

const DECADES: Array<[RegExp, [number, number]]> = [
  [/\b(?:19)?60s\b|sixties/, [1960, 1969]],
  [/\b(?:19)?70s\b|seventies/, [1970, 1979]],
  [/\b(?:19)?80s\b|eighties/, [1980, 1989]],
  [/\b(?:19)?90s\b|nineties/, [1990, 1999]],
  [/\b(?:20)?00s\b|two thousands|noughties/, [2000, 2009]],
  [/\b(?:20)?10s\b|twenty tens/, [2010, 2019]],
];

/** True when a local file belongs to the theme (folder name, tags, catalog genres, or decade). */
export function matchesTheme(theme: string, fields: { relPath: string; album?: string; genre?: string; year?: number; artist?: string; catalogGenres?: string[]; catalogYear?: number }) {
  const normalizedTheme = normalize(theme);
  if (/^(?:local|my (?:music|songs|library|collection)|everything|all)$/.test(normalizedTheme)) return true;
  const generic = new Set(['the', 'of', 'and', 'hits', 'songs', 'song', 'music', 'movies', 'movie', 'films', 'film', 'tv', 'shows', 'show', 'themes', 'theme', 'trivia', 'best', 'greatest', 'classic', 'classics']);
  const tokens = normalizedTheme.split(' ').filter(token => token.length > 1 && !generic.has(token));
  const haystack = normalize([fields.relPath.replace(/[\\/]/g, ' '), fields.album ?? '', fields.genre ?? '', fields.artist ?? '', ...(fields.catalogGenres ?? [])].join(' '));
  const decade = DECADES.find(([pattern]) => pattern.test(normalizedTheme));
  const year = fields.year ?? fields.catalogYear;
  if (decade && year && year >= decade[1][0] && year <= decade[1][1]) return true;
  if (decade) {
    // No usable year: only an explicit decade folder/tag ("80s", "eighties") counts.
    const decadeWords = normalizedTheme.replace(/^the\s+/, '').split(' ');
    return decadeWords.some(word => word.length >= 3 && haystack.split(' ').includes(word));
  }
  if (!tokens.length) return false;
  const hits = tokens.filter(token => haystack.includes(token)).length;
  if (hits === tokens.length || (tokens.length >= 3 && hits >= tokens.length - 1)) return true;
  const alias = GENRE_SYNONYMS[normalizedTheme];
  return Boolean(alias && alias.some(word => haystack.includes(word)));
}

/** Theme words that appear under other names in catalog genres. */
const GENRE_SYNONYMS: Record<string, string[]> = {
  'hip hop': ['rap', 'hip hop'], hiphop: ['rap', 'hip hop'], rap: ['rap', 'hip hop'], 'r b': ['r b', 'rnb', 'soul'], rnb: ['r b', 'soul'],
  electronic: ['electro', 'electronic', 'dance', 'techno', 'house'], edm: ['electro', 'dance', 'house'], dance: ['dance', 'electro', 'house', 'disco'],
  soul: ['soul', 'funk', 'r b'], funk: ['funk', 'soul'], latin: ['latin', 'latino', 'reggaeton'], 'classic rock': ['rock'], alternative: ['alternative', 'indie'],
  indie: ['indie', 'alternative'], metal: ['metal', 'hard rock'], punk: ['punk'], 'k pop': ['k pop', 'kpop', 'asian'], kpop: ['k pop', 'asian'],
};

interface DeezerAlbumInfo { genres?: { data?: Array<{ name?: string }> }; release_date?: string }

/** artist + title → Deezer album genres and release year (null when the catalog does not know the song). */
export async function enrichTrack(artist: string, title: string, fetchImpl: typeof fetch = fetch): Promise<{ genres: string[]; year?: number } | null> {
  const timeout = (ms: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  };
  const search = timeout(6000);
  try {
    const query = `artist:"${artist.replace(/"/g, '')}" track:"${title.replace(/"/g, '')}"`;
    const response = await fetchImpl(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`, { signal: search.signal });
    if (!response.ok) throw new Error(`deezer ${response.status}`);
    const data = (await response.json()) as { data?: Array<{ album?: { id?: number } }> };
    const albumId = data.data?.[0]?.album?.id;
    if (!albumId) return null;
    const album = timeout(6000);
    try {
      const albumResponse = await fetchImpl(`https://api.deezer.com/album/${albumId}`, { signal: album.signal });
      if (!albumResponse.ok) throw new Error(`deezer ${albumResponse.status}`);
      const info = (await albumResponse.json()) as DeezerAlbumInfo;
      const genres = (info.genres?.data ?? []).map(genre => genre.name).filter((name): name is string => Boolean(name));
      const year = Number(info.release_date?.slice(0, 4));
      return { genres, year: Number.isFinite(year) && year > 1900 ? year : undefined };
    } finally {
      album.done();
    }
  } finally {
    search.done();
  }
}

async function walk(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 5 || out.length >= MAX_FILES) return out;
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, out);
    else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

async function readTags(file: string): Promise<{ artist?: string; title?: string; album?: string; genre?: string; year?: number }> {
  if (!config.ffprobePath) return {};
  try {
    const { stdout } = await execFileAsync(config.ffprobePath, ['-v', 'error', '-show_entries', 'format_tags=artist,title,album,genre,date,year', '-of', 'json', file], { timeout: 8000 });
    const tags = (JSON.parse(String(stdout)).format?.tags ?? {}) as Record<string, string>;
    const lower: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) lower[key.toLowerCase()] = value;
    const year = Number(String(lower.date ?? lower.year ?? '').slice(0, 4));
    return { artist: lower.artist, title: lower.title, album: lower.album, genre: lower.genre, year: Number.isFinite(year) && year > 1900 ? year : undefined };
  } catch {
    return {};
  }
}

export class LocalLibrary {
  private settings: MediaSettings = settingsFromEnv();
  private songs: LocalTrack[] = [];
  private indexing: Promise<void> | null = null;
  private readonly envFile: string;
  private readonly indexFile: string;
  private listeners: Array<() => void> = [];

  constructor(cacheDir = config.cacheDir, envFile = ENV_FILE) {
    this.envFile = envFile;
    this.indexFile = join(cacheDir, 'local-index.json');
  }

  /** Loads the persisted index and starts a (re)scan of the folder from .env. */
  async init() {
    this.settings = settingsFromEnv();
    try {
      if (existsSync(this.indexFile)) {
        const index = JSON.parse(await readFile(this.indexFile, 'utf8')) as IndexFile;
        if (index.version === 3) this.songs = index.songs;
      }
    } catch {
      // rebuilt below
    }
    await this.reindex();
  }

  getSettings(): MediaSettings {
    return { ...this.settings };
  }

  /** Called whenever the GUI saves media sources: writes .env, re-indexes, and notifies pack builders. */
  async updateSettings(changes: Partial<MediaSettings>) {
    this.settings = {
      localSongsDir: typeof changes.localSongsDir === 'string' ? changes.localSongsDir.trim() : this.settings.localSongsDir,
      preferLocal: typeof changes.preferLocal === 'boolean' ? changes.preferLocal : this.settings.preferLocal,
    };
    process.env.LOCAL_SONGS_DIR = this.settings.localSongsDir;
    process.env.PREFER_LOCAL_MEDIA = String(this.settings.preferLocal);
    await upsertEnv(this.envFile, { LOCAL_SONGS_DIR: this.settings.localSongsDir, PREFER_LOCAL_MEDIA: String(this.settings.preferLocal) });
    await this.reindex();
    this.listeners.forEach(listener => listener());
    return this.status();
  }

  onChange(listener: () => void) {
    this.listeners.push(listener);
  }

  status() {
    return {
      settings: this.getSettings(),
      songs: this.songs.length,
      songsDirExists: Boolean(this.settings.localSongsDir) && existsSync(resolve(this.settings.localSongsDir)),
      indexing: this.indexing !== null,
      themes: this.impliedThemes(),
      envFile: this.envFile,
    };
  }

  /**
   * Themes the local collection can serve on its own: top-level folder names
   * and genre tags with at least a few songs. Used by prebuild so local music
   * is cached for every genre it applies to.
   */
  impliedThemes(minSongs = 4): string[] {
    const counts = new Map<string, number>();
    for (const track of this.songs) {
      const nested = /[\\/]/.test(track.relPath);
      const folder = track.relPath.split(/[\\/]/)[0];
      const candidates = new Set<string>();
      if (nested && folder) candidates.add(folder);
      if (track.genre) track.genre.split(/[;,/]/).map(genre => genre.trim()).filter(Boolean).forEach(genre => candidates.add(genre));
      for (const genre of track.catalogGenres ?? []) candidates.add(genre);
      for (const candidate of candidates) {
        const key = candidate.trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).filter(([, count]) => count >= minSongs).sort((a, b) => b[1] - a[1]).map(([theme]) => theme);
  }

  async reindex() {
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      try {
        this.songs = await this.indexSongs();
        await mkdir(dirname(this.indexFile), { recursive: true });
        const index: IndexFile = { version: 3, songs: this.songs, indexedAt: Date.now() };
        await writeFile(this.indexFile, JSON.stringify(index));
        if (this.songs.length) console.log(`[local] indexed ${this.songs.length} songs in ${this.settings.localSongsDir} (themes: ${this.impliedThemes().join(', ') || 'none'})`);
        if (this.songs.some(track => !track.enrichedAt)) setTimeout(() => void this.enrichFromCatalog().catch(() => undefined), 500);
      } catch (error) {
        console.warn('[local] indexing failed:', error instanceof Error ? error.message : error);
      } finally {
        this.indexing = null;
      }
    })();
    return this.indexing;
  }

  /**
   * Looks up genre + release year for tracks that have none, via the Deezer
   * catalog (artist + title → album → genres). Throttled, cached in the index,
   * and skipped offline; prebuild and theme matching pick the results up.
   */
  async enrichFromCatalog(limit = 400): Promise<number> {
    if (config.mode === 'mock' || !this.songs.length) return 0;
    const pending = this.songs.filter(track => !track.enrichedAt && track.artist && track.title).slice(0, limit);
    let enriched = 0;
    let failures = 0;
    for (const track of pending) {
      if (failures >= 3) break;
      try {
        const lookup = await enrichTrack(track.artist, track.title);
        track.enrichedAt = Date.now();
        if (lookup) {
          track.catalogGenres = lookup.genres;
          track.catalogYear = lookup.year ?? track.catalogYear;
          enriched += 1;
        }
        failures = 0;
      } catch {
        failures += 1;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (pending.length) {
      await mkdir(dirname(this.indexFile), { recursive: true });
      await writeFile(this.indexFile, JSON.stringify({ version: 3, songs: this.songs, indexedAt: Date.now() } satisfies IndexFile));
      if (enriched) console.log(`[local] catalog genres found for ${enriched}/${pending.length} songs (themes: ${this.impliedThemes().join(', ') || 'none'})`);
      if (enriched) this.listeners.forEach(listener => listener());
    }
    return enriched;
  }

  private async indexSongs(): Promise<LocalTrack[]> {
    const dir = this.settings.localSongsDir && resolve(this.settings.localSongsDir);
    if (!dir || !existsSync(dir)) return [];
    const known = new Map(this.songs.map(track => [track.path, track]));
    const files = await walk(dir);
    const tracks: LocalTrack[] = [];
    for (const file of files) {
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      const cached = known.get(file);
      if (cached && cached.mtimeMs === info.mtimeMs) {
        tracks.push(cached);
        continue;
      }
      const parsed = parseSongFilename(file);
      const tags = await readTags(file);
      tracks.push({
        path: file,
        relPath: relative(dir, file),
        artist: tags.artist?.trim() || parsed.artist,
        title: tags.title?.trim() || parsed.title,
        album: tags.album,
        genre: tags.genre,
        year: tags.year,
        mtimeMs: info.mtimeMs,
      });
    }
    return tracks;
  }

  tracksForTheme(theme: string): CatalogTrack[] {
    return this.songs
      .filter(track => matchesTheme(theme, track))
      .map((track, index) => ({
        key: `${track.artist.toLowerCase()}|${track.title.toLowerCase()}`,
        artist: track.artist || 'Unknown artist',
        title: track.title,
        localPath: track.path,
        album: track.album,
        year: track.year,
        provider: 'local' as const,
        popularity: 5 - index * 0.001,
      }));
  }

  hasAnything() {
    return this.songs.length > 0;
  }

  /** Changes whenever the media settings change; keyed into pack caches so stale packs are not reused. */
  signature() {
    return createHash('sha1').update(JSON.stringify(this.settings)).digest('hex').slice(0, 8);
  }
}

export const localLibrary = new LocalLibrary();
