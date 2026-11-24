import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, type ClipProviderName } from '../config.ts';
import { chooseSegment, type Segment } from './analyze.ts';
import { hasFfmpeg, probeDuration, sliceClip } from './ffmpeg.ts';
import { PROVIDERS, type ClipProvider, type ClipRequest, type SourceResult } from './providers.ts';

/**
 * Clip pipeline:  request ─▶ 1. fetch (catalog preview / local file / iTunes / Deezer / yt-dlp)
 *                         ─▶ 2. choose the excerpt (song opening; or hook via loudness/Gemini)
 *                         ─▶ 3. slice (ffmpeg, fades + loudness normalisation)
 *                         ─▶ 4. serve (/api/clips/:id, cached on disk)
 *
 * Jobs are keyed by a hash of the request so identical questions share work,
 * and finished clips persist in the cache directory across restarts.
 */
export interface ClipRecord {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  query: string;
  url?: string;
  filePath?: string;
  contentType?: string;
  /** Offset inside the served file (non-zero only when ffmpeg was unavailable). */
  offsetSeconds: number;
  durationSeconds?: number;
  provider?: ClipProviderName;
  sourceTitle?: string;
  sourceUrl?: string;
  label?: string;
  analysis?: Segment;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineOptions {
  cacheDir?: string;
  concurrency?: number;
  providers?: ClipProvider[];
  /** Test hook: override the segment chooser. */
  chooseSegment?: typeof chooseSegment;
}

/** Exact sources (local file, fresh catalog preview) run before any searching provider. */
function providersFor(request: ClipRequest): ClipProvider[] {
  const exact: ClipProvider[] = [];
  if (request.localPath) exact.push(PROVIDERS.local);
  if (request.directUrl) exact.push(PROVIDERS.preview);
  const searching = config.songProviders.map(name => PROVIDERS[name]);
  return [...exact, ...searching.filter(provider => !exact.includes(provider))];
}

export function clipRequestId(request: ClipRequest) {
  const key = JSON.stringify({
    artist: request.artist?.toLowerCase().trim() ?? '',
    title: request.title?.toLowerCase().trim() ?? '',
    query: request.query.toLowerCase().trim(),
    localPath: request.localPath ?? '',
    position: request.position ?? 'start',
    seconds: Math.round(request.targetSeconds),
    providers: config.songProviders,
  });
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

export class ClipPipeline {
  private readonly records = new Map<string, ClipRecord>();
  private readonly inflight = new Map<string, Promise<ClipRecord>>();
  private readonly queue: Array<{ priority: number; order: number; start: () => void }> = [];
  private running = 0;
  private queued = 0;
  private readonly cacheDir: string;
  private readonly options: PipelineOptions;
  private readonly concurrency: number;

  constructor(options: PipelineOptions = {}) {
    this.options = options;
    this.cacheDir = options.cacheDir ?? join(config.cacheDir, 'clips');
    this.concurrency = options.concurrency ?? config.clipConcurrency;
  }

  /**
   * Returns the clip record immediately and keeps working in the background.
   * Lower `priority` runs first (round-one clips before later rounds).
   */
  async prepare(request: ClipRequest, priority = 5): Promise<ClipRecord> {
    const id = clipRequestId(request);
    const existing = this.records.get(id) ?? (await this.loadFromDisk(id));
    if (existing && (existing.status !== 'failed' || Date.now() - existing.updatedAt < 60_000)) return existing;

    const record: ClipRecord = {
      id,
      status: 'pending',
      query: request.query,
      offsetSeconds: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.records.set(id, record);
    const job = new Promise<ClipRecord>(resolve => {
      this.queue.push({
        priority,
        order: ++this.queued,
        start: () => {
          this.running += 1;
          void this.run(record, request).then(resolve).finally(() => {
            this.running -= 1;
            this.inflight.delete(id);
            this.pump();
          });
        },
      });
      this.pump();
    });
    this.inflight.set(id, job);
    return record;
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
      this.queue.shift()!.start();
    }
  }

  /** Status snapshots for several clips at once (used by the client poller). */
  async getMany(ids: string[]): Promise<ClipRecord[]> {
    const records = await Promise.all(ids.map(id => this.get(id)));
    return records.filter((record): record is ClipRecord => record !== null);
  }

  /** Waits (bounded) for the clip to finish; useful for tests and pre-warming. */
  async waitFor(id: string, timeoutMs = 120_000): Promise<ClipRecord | null> {
    const job = this.inflight.get(id);
    if (!job) return this.get(id);
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
    return Promise.race([job, timeout]);
  }

  async get(id: string): Promise<ClipRecord | null> {
    return this.records.get(id) ?? (await this.loadFromDisk(id));
  }

  snapshot(record: ClipRecord) {
    const { filePath: _filePath, ...rest } = record;
    return rest;
  }

  private async run(record: ClipRecord, request: ClipRequest): Promise<ClipRecord> {
    const workDir = join(this.cacheDir, 'work', record.id);
    try {
      await mkdir(workDir, { recursive: true });
      await mkdir(this.cacheDir, { recursive: true });

      // 1. Scrape -----------------------------------------------------------
      const providers = this.options.providers ?? providersFor(request);
      let source: SourceResult | null = null;
      const failures: string[] = [];
      for (const provider of providers) {
        try {
          source = await provider.fetch(request, workDir);
          if (source) break;
          failures.push(`${provider.name}: no match`);
        } catch (error) {
          failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!source) throw new Error(failures.length ? failures.join('; ') : 'No clip providers available');
      record.provider = source.provider;
      record.sourceTitle = source.title;
      record.sourceUrl = source.sourceUrl;

      // 2. Analyse ----------------------------------------------------------
      const total = hasFfmpeg() ? await probeDuration(source.filePath) : source.durationSeconds ?? null;
      const segment = await (this.options.chooseSegment ?? chooseSegment)(source, request, workDir, total);
      if (!segment.isRequestedTrack) throw new Error(`Source "${source.title}" does not appear to be the requested recording`);
      record.analysis = segment;
      record.label = segment.label;

      // 3. Slice ------------------------------------------------------------
      const finalPath = join(this.cacheDir, `${record.id}.mp3`);
      if (hasFfmpeg()) {
        await sliceClip(source.filePath, finalPath, segment.startSeconds, segment.durationSeconds);
        record.filePath = finalPath;
        record.contentType = 'audio/mpeg';
        record.offsetSeconds = 0;
      } else {
        // No ffmpeg: serve the whole source and let the browser seek.
        const extension = source.contentType.includes('mp4') ? 'm4a' : source.contentType.includes('webm') ? 'webm' : 'mp3';
        const rawPath = join(this.cacheDir, `${record.id}.${extension}`);
        await copyFile(source.filePath, rawPath);
        record.filePath = rawPath;
        record.contentType = source.contentType;
        record.offsetSeconds = segment.startSeconds;
      }
      record.durationSeconds = segment.durationSeconds;
      record.url = `/api/clips/${record.id}`;
      record.status = 'ready';
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      console.warn(`[clips] "${request.query}" failed: ${record.error}`);
    } finally {
      record.updatedAt = Date.now();
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      if (record.status === 'ready') await this.saveToDisk(record).catch(() => undefined);
    }
    return record;
  }

  private async saveToDisk(record: ClipRecord) {
    await writeFile(join(this.cacheDir, `${record.id}.json`), JSON.stringify(record, null, 2));
  }

  private async loadFromDisk(id: string): Promise<ClipRecord | null> {
    const metaPath = join(this.cacheDir, `${id}.json`);
    if (!existsSync(metaPath)) return null;
    try {
      const record = JSON.parse(await readFile(metaPath, 'utf8')) as ClipRecord;
      if (!record.filePath || !existsSync(record.filePath)) return null;
      await stat(record.filePath);
      this.records.set(id, record);
      return record;
    } catch {
      return null;
    }
  }
}

export const clipPipeline = new ClipPipeline();
