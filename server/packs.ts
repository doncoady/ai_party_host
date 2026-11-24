import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClipRef, Difficulty, Question, ThemePack } from '../src/game/types.ts';
import { findBuiltinPack } from '../shared/packs/index.ts';
import { config } from './config.ts';
import { findTracksForTheme, trackKey, type CatalogTrack } from './catalog.ts';
import { localLibrary } from './local.ts';
import { clipPipeline, type ClipPipeline, type ClipRecord } from './clips/pipeline.ts';
import type { ClipRequest } from './clips/providers.ts';

/**
 * Theme packs, built for reliability and speed: a curated pack, or streaming
 * catalogs (Deezer playlists/genres/artists, iTunes compilations) plus the
 * local music library. No language model in the loop; a pack is ready in a
 * couple of seconds. Packs keep a pool larger than one game so rematches never
 * repeat a clip; requests with `exclude` extend the pool on demand.
 */
export interface PackRequest {
  theme: string;
  difficulty: Difficulty;
  clipSeconds: number;
  clipPosition?: 'start' | 'hook';
  /** Question ids already played; the returned pack excludes them. */
  exclude?: string[];
}

export interface PackResult {
  pack: ThemePack;
  origin: 'builtin' | 'cache' | 'catalog' | 'mock';
  sources: string[];
  warnings: string[];
  buildMs: number;
}

export const SONG_POOL_SIZE = Number(process.env.SONG_POOL_SIZE || 24);
const PACK_BUILD_BUDGET_MS = Number(process.env.PACK_BUILD_TIMEOUT_MS || 14_000);

function packId(theme: string, difficulty: Difficulty) {
  return createHash('sha1').update(`${theme.toLowerCase().trim()}|${difficulty}|${localLibrary.signature()}|v3`).digest('hex').slice(0, 12);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms);
    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// ---------------------------------------------------------------- songs
const CORRECT_LINES = [
  'Correct. Your ears are officially certified.',
  'Correct. Somebody paid attention to the radio.',
  'Nailed it. The jukebox approves.',
  'Correct. That one was in your bones.',
  'Yes! Name that tune, indeed.',
];

export function spokenAliases(track: { artist: string; title: string }): string[] {
  const aliases = new Set<string>();
  const title = track.title.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  const artist = track.artist.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  for (const value of [title, artist]) {
    if (!value) continue;
    aliases.add(value.toLowerCase());
    aliases.add(value.toLowerCase().replace(/^the\s+/, ''));
    aliases.add(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());
  }
  const artistParts = artist.split(/\s*(?:,|&|\band\b|feat\.?|ft\.?|featuring|x)\s*/i).map(part => part.trim()).filter(part => part.length > 2);
  artistParts.forEach(part => aliases.add(part.toLowerCase()));
  const titleHead = title.split(/\s*[-:/]\s*/)[0]?.trim();
  if (titleHead && titleHead.length > 2) aliases.add(titleHead.toLowerCase());
  return Array.from(aliases).filter(Boolean).slice(0, 10);
}

export function songQuestion(track: CatalogTrack, pool: CatalogTrack[], index: number, theme: string): Question {
  const distractors = pool
    .filter(other => other.key !== track.key && other.artist.toLowerCase() !== track.artist.toLowerCase())
    .slice(0, 40);
  const picked: string[] = [];
  for (let step = 0; picked.length < 3 && distractors.length; step++) {
    const candidate = distractors[(index * 7 + step * 5) % distractors.length];
    const label = `${candidate.artist} ("${candidate.title}")`;
    if (!picked.includes(label)) picked.push(label);
    if (step > 40) break;
  }
  while (picked.length < 3) picked.push(`(other ${picked.length + 1})`);
  const hint = track.year
    ? `Released in ${track.year}.`
    : track.album && track.album.toLowerCase() !== track.title.toLowerCase()
    ? `From the album "${track.album}".`
    : `The artist's name starts with "${track.artist.trim()[0]?.toUpperCase() ?? '?'}".`;
  const points = 1000 + Math.min(4, Math.floor(index / 4)) * 250;
  return {
    id: `song-${createHash('sha1').update(track.key).digest('hex').slice(0, 10)}`,
    category: `${theme.toUpperCase()} · NAME THAT TUNE`,
    title: 'Name That Tune',
    question: 'Name the song or the artist.',
    hostClue: hint,
    type: 'SONG_CLIP',
    options: [`${track.artist} ("${track.title}")`, ...picked],
    correctIndex: 0,
    acceptedAnswers: spokenAliases(track),
    basePoints: points,
    explanation: `"${track.title}" by ${track.artist}${track.album && track.album.toLowerCase() !== track.title.toLowerCase() ? `, from "${track.album}"` : ''}${track.year ? ` (${track.year})` : ''}.`,
    hostCorrectRoast: CORRECT_LINES[index % CORRECT_LINES.length],
    hostWrongRoast: `That was "${track.title}" by ${track.artist}.`,
    song: { artist: track.artist, title: track.title, year: track.year, previewUrl: track.previewUrl, localPath: track.localPath },
  };
}

// ---------------------------------------------------------------- mock
const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];

/** Deterministic synthetic pack for mock mode and end-to-end tests: answers are the NATO alphabet in order. */
export function mockPack(theme: string): ThemePack {
  const questions: Question[] = NATO.map((answer, index) => ({
    id: `mock-${index + 1}`,
    category: `${theme.toUpperCase()} TUNES`,
    title: `Mock question ${index + 1}`,
    question: `Mock ${theme} question number ${index + 1}. The answer is ${answer}.`,
    hostClue: `Clue ${index + 1} for ${theme}.`,
    type: 'SONG_CLIP',
    options: [answer, ...NATO.filter(word => word !== answer).slice(index % 3, index % 3 + 3)],
    correctIndex: 0,
    acceptedAnswers: [answer.toLowerCase(), `${answer.toLowerCase()} ${index + 1}`],
    basePoints: 1000 + (index % 4) * 250,
    explanation: `Mock explanation ${index + 1}: the answer was ${answer}.`,
    hostCorrectRoast: `Mock roast: correct, ${answer} it is.`,
    hostWrongRoast: `Mock roast: it was ${answer}.`,
    song: { artist: `Mock Artist ${index + 1}`, title: `${answer} Song`, year: 1980 + index },
  }));
  return { id: `mock-${theme.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, theme, label: theme, tagline: `Mock ${theme} pack.`, source: 'mock', questions };
}

// ---------------------------------------------------------------- service
interface CachedPack {
  pack: ThemePack;
  /** Catalog keys already in the pack, so extensions fetch different tracks. */
  trackKeys: string[];
}

export class PackService {
  private readonly cacheDir: string;
  private readonly memory = new Map<string, CachedPack>();
  private readonly building = new Map<string, Promise<PackResult | null>>();
  private readonly pipeline: ClipPipeline;

  constructor(pipeline: ClipPipeline = clipPipeline, cacheDir = join(config.cacheDir, 'packs')) {
    this.pipeline = pipeline;
    this.cacheDir = cacheDir;
    localLibrary.onChange(() => {
      // Media sources changed: forget catalog packs so they rebuild with the new library.
      for (const [id, cached] of this.memory) if (cached.pack.source !== 'builtin') this.memory.delete(id);
    });
  }

  async resolve(request: PackRequest): Promise<PackResult | null> {
    const startedAt = Date.now();
    const theme = request.theme.trim().slice(0, 80);
    const exclude = new Set(request.exclude ?? []);
    const finish = (pack: ThemePack, origin: PackResult['origin'], sources: string[] = [], warnings: string[] = []): Promise<PackResult> =>
      this.attachClips(pack, request.clipSeconds, request.clipPosition).then(attached => ({
        pack: { ...attached, questions: attached.questions.filter(question => !exclude.has(question.id)) },
        origin,
        sources,
        warnings,
        buildMs: Date.now() - startedAt,
      }));

    const builtin = findBuiltinPack(theme);
    if (builtin) {
      const extended = await this.extendIfNeeded(builtin, theme, request, exclude);
      return finish(extended.pack, 'builtin', extended.sources, extended.warnings);
    }

    if (config.mode === 'mock') return finish(mockPack(theme), 'mock', ['mock']);

    const id = packId(theme, request.difficulty);
    const cached = this.memory.get(id) ?? (await this.loadCached(id));
    if (cached) {
      const extended = await this.extendIfNeeded(cached.pack, theme, request, exclude, cached);
      return finish(extended.pack, 'cache', extended.sources, extended.warnings);
    }

    // Single in-flight build per theme so a retry never doubles the work.
    const inflight = this.building.get(id) ?? this.build(id, theme, request).finally(() => this.building.delete(id));
    this.building.set(id, inflight);
    const built = await inflight;
    if (!built) return null;
    return finish(built.pack, 'catalog', built.sources, built.warnings);
  }

  private async build(id: string, theme: string, request: PackRequest): Promise<PackResult | null> {
    void request;
    const startedAt = Date.now();
    const warnings: string[] = [];
    const catalog = await withTimeout(findTracksForTheme(theme, SONG_POOL_SIZE), PACK_BUILD_BUDGET_MS, 'catalog search').catch(error => {
      warnings.push(error instanceof Error ? error.message : String(error));
      return { tracks: [], sources: [], errors: [] };
    });
    warnings.push(...catalog.errors);
    const songs = catalog.tracks.map((track, index) => songQuestion(track, catalog.tracks, index, theme));
    if (songs.length < 4) {
      console.warn(`[packs] "${theme}": only ${songs.length} songs (${catalog.sources.join(', ') || 'no sources'}) ${warnings.join(' | ')}`);
      return null;
    }
    const pack: ThemePack = {
      id: `cat-${id}`,
      theme,
      label: theme,
      tagline: `${songs.length} tunes cued up.`,
      source: 'generated',
      questions: songs,
    };
    const entry: CachedPack = { pack, trackKeys: catalog.tracks.map(track => track.key) };
    this.memory.set(id, entry);
    await this.saveCached(id, entry).catch(error => console.warn('[packs] could not cache pack:', error));
    console.log(`[packs] "${theme}": ${songs.length} songs from ${catalog.sources.join(', ') || 'nothing'} in ${Date.now() - startedAt} ms`);
    return { pack, origin: 'catalog', sources: catalog.sources, warnings, buildMs: Date.now() - startedAt };
  }

  /**
   * When most of a pack has been played (rematches), pull more tracks from the
   * catalogs/local library so no clip is ever repeated.
   */
  private async extendIfNeeded(pack: ThemePack, theme: string, request: PackRequest, exclude: Set<string>, cached?: CachedPack) {
    const sources: string[] = [];
    const warnings: string[] = [];
    const unused = pack.questions.filter(question => !exclude.has(question.id)).length;
    let result = pack;
    if (exclude.size && unused < 8 && config.mode !== 'mock') {
      const known = new Set([...(cached?.trackKeys ?? []), ...pack.questions.map(question => trackKey(question.song.artist, question.song.title))]);
      const catalog = await withTimeout(findTracksForTheme(theme, SONG_POOL_SIZE, known), PACK_BUILD_BUDGET_MS, 'catalog search').catch(error => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return { tracks: [], sources: [], errors: [] };
      });
      if (catalog.tracks.length) {
        const extra = catalog.tracks.map((track, index) => songQuestion(track, catalog.tracks, pack.questions.length + index, theme));
        result = { ...pack, questions: [...pack.questions, ...extra] };
        sources.push(...catalog.sources);
        if (cached) {
          cached.pack = result;
          cached.trackKeys.push(...catalog.tracks.map(track => track.key));
          await this.saveCached(packId(theme, request.difficulty), cached).catch(() => undefined);
        }
      }
    }
    return { pack: result, sources, warnings };
  }

  /** Starts clip jobs for every media question and attaches their current status. Songs first. */
  async attachClips(pack: ThemePack, clipSeconds: number, clipPosition: 'start' | 'hook' = 'start'): Promise<ThemePack> {
    const questions = await Promise.all(pack.questions.map(async (question, index) => {
      const request = clipRequestFor(question, clipSeconds, clipPosition);
      const record = await this.pipeline.prepare(request, index / 100);
      return { ...question, clip: toClipRef(record) };
    }));
    return { ...pack, questions };
  }

  /** Builds and caches packs for a list of themes (boot, install, or after media settings change). */
  async prebuild(themes: string[], clipSeconds: number) {
    for (const theme of Array.from(new Set(themes.map(theme => theme.trim()).filter(Boolean)))) {
      try {
        const result = await this.resolve({ theme, difficulty: 'medium', clipSeconds });
        if (result) console.log(`[packs] prebuilt "${theme}" (${result.origin}, ${result.pack.questions.length} questions)`);
      } catch (error) {
        console.warn(`[packs] prebuild "${theme}" failed:`, error instanceof Error ? error.message : error);
      }
    }
  }

  private async loadCached(id: string): Promise<CachedPack | null> {
    const file = join(this.cacheDir, `${id}.json`);
    if (!existsSync(file)) return null;
    try {
      const entry = JSON.parse(await readFile(file, 'utf8')) as CachedPack;
      if (!entry.pack?.questions) return null;
      this.memory.set(id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async saveCached(id: string, entry: CachedPack) {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(join(this.cacheDir, `${id}.json`), JSON.stringify(entry));
  }
}

export function clipRequestFor(question: Question, clipSeconds: number, clipPosition: 'start' | 'hook' = 'start'): ClipRequest {
  return {
    query: `${question.song.artist} ${question.song.title}`,
    artist: question.song.artist,
    title: question.song.title,
    year: question.song.year,
    directUrl: question.song.previewUrl,
    localPath: question.song.localPath,
    targetSeconds: clipSeconds,
    position: clipPosition,
  };
}

export function toClipRef(record: ClipRecord): ClipRef {
  return {
    id: record.id,
    status: record.status,
    url: record.url,
    offsetSeconds: record.offsetSeconds,
    durationSeconds: record.durationSeconds,
    provider: record.provider,
    sourceTitle: record.sourceTitle,
    sourceUrl: record.sourceUrl,
    label: record.label,
    error: record.error,
  };
}

export const packService = new PackService();
