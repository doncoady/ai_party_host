import type { ClipRef, Difficulty, Question, ThemePack } from '../game/types.ts';
import { findBuiltinPack, DEFAULT_PACK } from '../../shared/packs/index.ts';

export interface PackResponse {
  pack: ThemePack;
  origin: 'builtin' | 'cache' | 'catalog' | 'mock';
  sources?: string[];
  warnings?: string[];
  buildMs?: number;
}

export interface MediaSettingsStatus {
  settings: { localSongsDir: string; preferLocal: boolean };
  songs: number;
  songsDirExists: boolean;
  indexing: boolean;
  /** Genres/folders the local collection covers. */
  themes: string[];
  envFile: string;
}

export interface ServerCapabilities {
  status: string;
  mode: 'live' | 'mock';
  hasApiKey: boolean;
  ffmpeg: boolean;
  ytdlp: boolean;
  songProviders: string[];
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCapabilities(): Promise<ServerCapabilities | null> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) return null;
    return (await response.json()) as ServerCapabilities;
  } catch {
    return null;
  }
}

/**
 * Loads a pack for a theme. Built-in packs are always available even when the
 * server is unreachable, so the game can start offline.
 */
export async function loadThemePack(theme: string, difficulty: Difficulty, clipSeconds: number, options: { exclude?: string[]; clipPosition?: 'start' | 'hook' } = {}): Promise<PackResponse> {
  try {
    // Catalog lookups are time-boxed server-side (~14 s); fail fast rather than leave players waiting.
    return await postJson<PackResponse>('/api/theme/pack', { theme, difficulty, clipSeconds, clipPosition: options.clipPosition ?? 'start', exclude: options.exclude ?? [] }, 25_000);
  } catch (error) {
    const builtin = findBuiltinPack(theme);
    if (builtin) return { pack: builtin, origin: 'builtin' };
    throw error;
  }
}

export async function fetchMediaSettings(): Promise<MediaSettingsStatus | null> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return null;
    return (await response.json()) as MediaSettingsStatus;
  } catch {
    return null;
  }
}

export async function saveMediaSettings(settings: Partial<MediaSettingsStatus['settings']>): Promise<MediaSettingsStatus> {
  const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Could not save settings (${response.status})`);
  return data as MediaSettingsStatus;
}

export interface SpeechFetchResult {
  audio: string | null;
  status: number;
  /** Seconds to wait before asking again (from Retry-After on 429/503). */
  retryAfterSeconds: number | null;
}

/** Renders a host line with Gemini TTS. Reports rate limits so the caller can back off instead of hammering. */
export async function fetchSpeech(text: string, signal?: AbortSignal): Promise<SpeechFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const response = await fetch('/api/host-speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal });
    const retryAfter = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    if (!response.ok) return { audio: null, status: response.status, retryAfterSeconds };
    const data = (await response.json()) as { audioBase64?: string };
    return { audio: data.audioBase64 ?? null, status: response.status, retryAfterSeconds: null };
  } catch {
    return { audio: null, status: 0, retryAfterSeconds: null };
  } finally {
    clearTimeout(timer);
  }
}
/** Curated pack used when someone explicitly asks for it (the server is the normal path). */
export function fallbackPack(): ThemePack {
  return DEFAULT_PACK;
}

/** Batch status for many clips at once (the UI polls this while clips cache in the background). */
export async function fetchClipStatuses(ids: string[]): Promise<ClipRef[]> {
  if (!ids.length) return [];
  try {
    const response = await fetch(`/api/clips/status?ids=${encodeURIComponent(ids.slice(0, 64).join(','))}`);
    if (!response.ok) return [];
    const data = (await response.json()) as { clips?: ClipRef[] };
    return data.clips ?? [];
  } catch {
    return [];
  }
}

export async function fetchClipStatus(clip: ClipRef): Promise<ClipRef> {
  try {
    const response = await fetch(`/api/clips/${encodeURIComponent(clip.id)}/status`);
    if (!response.ok) return clip;
    return { ...clip, ...(await response.json()) };
  } catch {
    return clip;
  }
}

export async function judgeAnswer(question: Question, transcript: string): Promise<number | null> {
  try {
    const result = await postJson<{ optionIndex: number | null }>('/api/judge', {
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      transcript,
    }, 4000);
    return typeof result.optionIndex === 'number' ? result.optionIndex : null;
  } catch {
    return null;
  }
}

