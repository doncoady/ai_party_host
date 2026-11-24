import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

export function hasFfmpeg() {
  return Boolean(config.ffmpegPath);
}

async function runFfmpeg(args: string[], options: { timeoutMs?: number; maxBuffer?: number } = {}) {
  if (!config.ffmpegPath) throw new Error('ffmpeg is not installed');
  return execFileAsync(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    encoding: 'buffer',
  });
}

/** Duration in seconds, via ffprobe when available or ffmpeg's null muxer otherwise. */
export async function probeDuration(filePath: string): Promise<number | null> {
  if (config.ffprobePath) {
    try {
      const { stdout } = await execFileAsync(config.ffprobePath, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ], { timeout: 20_000 });
      const value = Number(String(stdout).trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // fall through to ffmpeg
    }
  }
  if (!config.ffmpegPath) return null;
  try {
    const { stderr } = await execFileAsync(config.ffmpegPath, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], { timeout: 60_000 });
    const match = String(stderr).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)?.pop()?.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } catch {
    return null;
  }
}

/**
 * Cuts [start, start+duration) into a normalised mono MP3 with short fades so
 * the excerpt starts and ends cleanly no matter where the hook lands.
 */
export async function sliceClip(input: string, output: string, startSeconds: number, durationSeconds: number) {
  const fadeOut = Math.min(0.35, durationSeconds / 4);
  const filters = [
    `afade=t=in:st=0:d=0.04`,
    `afade=t=out:st=${Math.max(0, durationSeconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(',');
  await runFfmpeg([
    '-y',
    '-ss', startSeconds.toFixed(3),
    '-t', durationSeconds.toFixed(3),
    '-i', input,
    '-vn',
    '-ac', '1',
    '-ar', '44100',
    '-af', filters,
    '-c:a', 'libmp3lame',
    '-q:a', '3',
    output,
  ]);
}

/** Small mono MP3 (16 kHz / 32 kbps) so Gemini can listen to a whole track cheaply. */
export async function transcodeForAnalysis(input: string, output: string, maxSeconds: number) {
  await runFfmpeg(['-y', '-t', String(maxSeconds), '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-c:a', 'libmp3lame', output], { timeoutMs: 120_000 });
}

/** Renders a synthetic test tone (used by the mock provider and tests). */
export async function renderTestTone(output: string, seconds: number, frequency = 440) {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequency}:duration=${seconds}`,
    '-af', `volume=0.4,tremolo=f=2:d=0.6`,
    '-c:a', 'libmp3lame',
    '-q:a', '5',
    output,
  ]);
}

/** First moment the track is audible (skips leading silence / fade-in). */
export async function findFirstAudible(filePath: string, thresholdRms = 0.02): Promise<number | null> {
  if (!config.ffmpegPath) return null;
  const sampleRate = 4000;
  const { stdout } = await runFfmpeg(['-t', '20', '-i', filePath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { timeoutMs: 60_000 });
  const pcm = stdout as Buffer;
  const blockSize = Math.floor(sampleRate * 0.1);
  const samples = Math.floor(pcm.length / 2);
  for (let offset = 0; offset + blockSize <= samples; offset += blockSize) {
    let energy = 0;
    for (let i = 0; i < blockSize; i++) {
      const sample = pcm.readInt16LE((offset + i) * 2) / 32768;
      energy += sample * sample;
    }
    if (Math.sqrt(energy / blockSize) >= thresholdRms) return offset / sampleRate;
  }
  return 0;
}

/**
 * Decodes the track to low-rate PCM and finds the most energetic window.
 * Used as the analysis fallback: the loudest sustained section of a pop song
 * is almost always the chorus, which is what people recognise.
 */
export async function findLoudestWindow(filePath: string, windowSeconds: number, options: { skipStartFraction?: number; skipEndFraction?: number } = {}): Promise<{ startSeconds: number; score: number } | null> {
  if (!config.ffmpegPath) return null;
  const sampleRate = 4000;
  const { stdout } = await runFfmpeg(['-i', filePath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { timeoutMs: 120_000, maxBuffer: 256 * 1024 * 1024 });
  const pcm = stdout as Buffer;
  const samples = Math.floor(pcm.length / 2);
  if (samples < sampleRate) return null;
  const blockSize = Math.floor(sampleRate * 0.25);
  const blocks: number[] = [];
  for (let offset = 0; offset + blockSize <= samples; offset += blockSize) {
    let energy = 0;
    for (let i = 0; i < blockSize; i++) {
      const sample = pcm.readInt16LE((offset + i) * 2) / 32768;
      energy += sample * sample;
    }
    blocks.push(Math.sqrt(energy / blockSize));
  }
  const totalSeconds = samples / sampleRate;
  const windowBlocks = Math.max(1, Math.round(windowSeconds / 0.25));
  const skipStart = Math.floor(blocks.length * (options.skipStartFraction ?? 0));
  const skipEnd = Math.floor(blocks.length * (options.skipEndFraction ?? 0));
  let best = { startSeconds: 0, score: -1 };
  let running = 0;
  for (let i = 0; i < blocks.length; i++) {
    running += blocks[i];
    if (i >= windowBlocks) running -= blocks[i - windowBlocks];
    const windowStart = i - windowBlocks + 1;
    if (windowStart < skipStart || i >= blocks.length - skipEnd) continue;
    if (windowStart < 0) continue;
    const score = running / windowBlocks;
    if (score > best.score) best = { startSeconds: windowStart * 0.25, score };
  }
  if (best.score < 0) return null;
  return { startSeconds: Math.min(best.startSeconds, Math.max(0, totalSeconds - windowSeconds)), score: best.score };
}
