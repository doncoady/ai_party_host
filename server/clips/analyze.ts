import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { generateJson } from '../gemini.ts';
import { findFirstAudible, findLoudestWindow, hasFfmpeg, transcodeForAnalysis } from './ffmpeg.ts';
import type { ClipRequest, SourceResult } from './providers.ts';

export interface Segment {
  startSeconds: number;
  durationSeconds: number;
  label: string;
  method: 'gemini' | 'loudness' | 'head' | 'start';
  confidence: number;
  /** Whether the analyser believes the source is the requested recording. */
  isRequestedTrack: boolean;
}

const SEGMENT_SCHEMA = {
  type: 'object',
  properties: {
    isRequestedTrack: { type: 'boolean' },
    startSeconds: { type: 'number' },
    endSeconds: { type: 'number' },
    label: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['isRequestedTrack', 'startSeconds', 'endSeconds', 'label', 'confidence'],
};

const MAX_ANALYSIS_BYTES = 12 * 1024 * 1024;

/**
 * Stage 2 of the pipeline: decide which seconds of the source to play.
 *
 *  1. Gemini listens to a compressed proxy of the track and returns the most
 *     recognisable excerpt (chorus hook, signature riff, the exact quoted line).
 *  2. Without Gemini, the loudest sustained window is used (the chorus,
 *     statistically). Default "start" mode skips analysis entirely.
 */
export async function chooseSegment(source: SourceResult, request: ClipRequest, workDir: string, totalSeconds: number | null): Promise<Segment> {
  const target = Math.min(config.maxClipSeconds, Math.max(1, request.targetSeconds));
  const total = totalSeconds ?? source.durationSeconds ?? null;

  // Song openings: intros and first riffs are recognisable and rarely sing the title.
  // Full tracks (local files, yt-dlp) start from the first audible moment of the song;
  // previews can only offer the very start of the preview window.
  if ((request.position ?? 'start') === 'start') {
    let start = 0;
    if (hasFfmpeg()) start = (await findFirstAudible(source.filePath).catch(() => 0)) ?? 0;
    const maxStart = total ? Math.max(0, total - target) : start;
    return { startSeconds: Math.min(start, maxStart), durationSeconds: target, label: source.isExcerpt ? 'preview opening' : 'song intro', method: 'start', confidence: 0.7, isRequestedTrack: true };
  }

  // Previews are already the hook region; a local loudness scan finds the chorus in well under a second.
  const useGemini = source.provider !== 'mock' && (config.clipAnalysis === 'gemini' || (config.clipAnalysis === 'auto' && !source.isExcerpt));
  const gemini = useGemini
    ? await analyseWithGemini(source, request, workDir, total, target).catch(error => {
        console.warn(`[clips] Gemini analysis failed for "${request.query}":`, error instanceof Error ? error.message : error);
        return null;
      })
    : null;
  if (gemini) return gemini;

  if (hasFfmpeg()) {
    try {
      const loudest = await findLoudestWindow(source.filePath, target, source.isExcerpt ? {} : { skipStartFraction: 0.12, skipEndFraction: 0.12 });
      if (loudest) {
        return { startSeconds: loudest.startSeconds, durationSeconds: target, label: 'loudest section', method: 'loudness', confidence: 0.5, isRequestedTrack: true };
      }
    } catch (error) {
      console.warn('[clips] loudness analysis failed:', error instanceof Error ? error.message : error);
    }
  }

  const start = total && total > target * 3 ? Math.min(total * 0.35, total - target) : 0;
  return { startSeconds: start, durationSeconds: target, label: 'default offset', method: 'head', confidence: 0.3, isRequestedTrack: true };
}

async function analyseWithGemini(source: SourceResult, request: ClipRequest, workDir: string, total: number | null, target: number): Promise<Segment | null> {
  if (!config.hasGemini) return null;
  let proxyPath = source.filePath;
  let mimeType = source.contentType.split(';')[0];
  if (hasFfmpeg()) {
    proxyPath = join(workDir, 'analysis.mp3');
    await transcodeForAnalysis(source.filePath, proxyPath, config.maxSourceSeconds);
    mimeType = 'audio/mpeg';
  }
  const info = await stat(proxyPath);
  if (info.size > MAX_ANALYSIS_BYTES) return null;
  const data = await readFile(proxyPath);

  const description = `This should be the recording "${request.title ?? request.query}" by ${request.artist ?? 'an unknown artist'}${request.year ? ` (${request.year})` : ''}.`;
  const goal = `Find the single most instantly recognisable ${target}-second excerpt: the main chorus hook or the signature riff, preferably one that does NOT sing the song title. Start on a musical phrase boundary.`;
  const prompt = `You are selecting an audio excerpt for a Name That Tune party game. ${description}
Source title: "${source.title}". ${total ? `Total duration: ${total.toFixed(1)} seconds.` : ''}
${goal}
Return JSON with: isRequestedTrack (false if this is clearly a different recording, a cover, or unrelated), startSeconds, endSeconds (endSeconds - startSeconds must be ${target}), label (a few words describing the moment), confidence (0-1).`;

  const result = await generateJson<{ isRequestedTrack: boolean; startSeconds: number; endSeconds: number; label: string; confidence: number }>(prompt, SEGMENT_SCHEMA, {
    temperature: 0.2,
    audio: { data, mimeType },
  });
  if (!result || !Number.isFinite(result.startSeconds)) return null;
  const maxStart = total ? Math.max(0, total - target) : Number.POSITIVE_INFINITY;
  const startSeconds = Math.min(maxStart, Math.max(0, result.startSeconds));
  return {
    startSeconds,
    durationSeconds: target,
    label: result.label || 'hook',
    method: 'gemini',
    confidence: Math.min(1, Math.max(0, Number(result.confidence) || 0.5)),
    isRequestedTrack: result.isRequestedTrack !== false,
  };
}
