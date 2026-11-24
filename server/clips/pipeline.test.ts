import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClipPipeline, clipRequestId } from './pipeline.ts';
import { mockProvider, type ClipProvider, type ClipRequest } from './providers.ts';
import { findLoudestWindow, hasFfmpeg, probeDuration, renderTestTone } from './ffmpeg.ts';

const songRequest: ClipRequest = { query: 'Mock Artist Alpha Song', artist: 'Mock Artist', title: 'Alpha Song', targetSeconds: 3 };

test('clip ids are stable for equivalent requests and differ by length', () => {
  assert.equal(clipRequestId(songRequest), clipRequestId({ ...songRequest, artist: 'mock artist ' }));
  assert.notEqual(clipRequestId(songRequest), clipRequestId({ ...songRequest, targetSeconds: 5 }));
});

test('pipeline: scrape → analyse → slice → serve (mock source, real ffmpeg)', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'clips-'));
  try {
    const pipeline = new ClipPipeline({ cacheDir, providers: [mockProvider] });
    const record = await pipeline.prepare(songRequest);
    assert.equal(record.status, 'pending');
    const done = await pipeline.waitFor(record.id, 60_000);
    assert.ok(done);
    assert.equal(done.status, 'ready', done.error);
    assert.equal(done.provider, 'mock');
    assert.equal(done.durationSeconds, 3);
    assert.equal(done.offsetSeconds, 0);
    assert.equal(done.analysis?.method, 'start', 'clips come from the opening of the song by default');
    assert.ok((done.analysis?.startSeconds ?? 1) < 0.5);
    assert.equal(done.url, `/api/clips/${record.id}`);
    const duration = await probeDuration(done.filePath!);
    assert.ok(duration && Math.abs(duration - 3) < 0.3, `sliced clip should be ~3s, got ${duration}`);
    assert.ok((await stat(done.filePath!)).size > 1000);

    // Cached on disk and reloaded by a fresh pipeline instance.
    const meta = JSON.parse(await readFile(join(cacheDir, `${record.id}.json`), 'utf8'));
    assert.equal(meta.status, 'ready');
    const second = new ClipPipeline({ cacheDir });
    const reloaded = await second.get(record.id);
    assert.equal(reloaded?.status, 'ready');
    const again = await second.prepare(songRequest);
    assert.equal(again.status, 'ready', 'a cached clip is returned without re-running the job');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('pipeline falls through providers and records failures', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'clips-'));
  try {
    const failing: ClipProvider = { name: 'itunes', fetch: async () => { throw new Error('network down'); } };
    const empty: ClipProvider = { name: 'ytdlp', fetch: async () => null };
    const pipeline = new ClipPipeline({ cacheDir, providers: [failing, empty] });
    const record = await pipeline.prepare({ ...songRequest, query: 'unavailable song' });
    const done = await pipeline.waitFor(record.id);
    assert.equal(done?.status, 'failed');
    assert.match(done?.error ?? '', /network down/);
    assert.match(done?.error ?? '', /ytdlp: no match/);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('pipeline rejects sources the analyser says are the wrong recording', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'clips-'));
  try {
    const pipeline = new ClipPipeline({
      cacheDir,
      providers: [mockProvider],
      chooseSegment: async () => ({ startSeconds: 0, durationSeconds: 3, label: 'cover version', method: 'gemini', confidence: 0.9, isRequestedTrack: false }),
    });
    const record = await pipeline.prepare({ ...songRequest, query: 'wrong recording' });
    const done = await pipeline.waitFor(record.id);
    assert.equal(done?.status, 'failed');
    assert.match(done?.error ?? '', /does not appear to be the requested recording/);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('loudness heuristic finds the loud section of a track', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tone-'));
  try {
    // Quiet 4s, loud 3s, quiet 3s.
    const file = join(dir, 'dyn.mp3');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { config } = await import('../config.ts');
    await promisify(execFile)(config.ffmpegPath!, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-af', "volume=enable='between(t,4,7)':volume=1.0,volume=enable='not(between(t,4,7))':volume=0.05",
      '-c:a', 'libmp3lame', file,
    ]);
    const best = await findLoudestWindow(file, 3);
    assert.ok(best);
    assert.ok(best.startSeconds >= 3.5 && best.startSeconds <= 4.5, `expected the loud window near 4s, got ${best.startSeconds}`);
    await renderTestTone(join(dir, 'tone.mp3'), 1);
    assert.ok((await stat(join(dir, 'tone.mp3'))).size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('hook mode picks the loudest window instead of the opening', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'clips-'));
  try {
    const pipeline = new ClipPipeline({ cacheDir, providers: [mockProvider] });
    const record = await pipeline.prepare({ ...songRequest, query: 'hook please', position: 'hook' });
    const done = await pipeline.waitFor(record.id, 60_000);
    assert.equal(done?.status, 'ready', done?.error);
    assert.equal(done?.analysis?.method, 'loudness');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
