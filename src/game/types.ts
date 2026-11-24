/** The game is Name That Tune: every question is an authentic song excerpt. */
export type QuestionType = 'SONG_CLIP';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
  borderHex: string;
  bgHex: string;
  avatar: string;
  correctCount: number;
  streak: number;
}

/** Reference to an authentic media clip prepared by the server clip pipeline. */
export interface ClipRef {
  /** Server job / clip id. Resolved lazily through /api/clips/:id. */
  id: string;
  status: 'pending' | 'ready' | 'failed';
  url?: string;
  /** Seconds into the served file where the excerpt starts (0 when pre-sliced). */
  offsetSeconds?: number;
  durationSeconds?: number;
  provider?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  label?: string;
  error?: string;
}

export interface SongRef {
  artist: string;
  title: string;
  year?: number;
  /** Preview URL from the catalog lookup (exact track). */
  previewUrl?: string;
  /** File in a configured local collection. */
  localPath?: string;
}

export interface Question {
  id: string;
  category: string;
  title: string;
  question: string;
  /** Spoken clue read by the host before any media. */
  hostClue: string;
  type: QuestionType;
  options: string[];
  correctIndex: number;
  /** Extra spoken aliases that count as the correct answer. */
  acceptedAnswers?: string[];
  basePoints: number;
  explanation: string;
  hostCorrectRoast: string;
  hostWrongRoast: string;
  song: SongRef;
  clip?: ClipRef;
  sponsorTitle?: string;
  sponsorCopy?: string;
}

export interface ThemePack {
  id: string;
  theme: string;
  /** Short host-friendly label such as "the 80s" or "Star Wars". */
  label: string;
  tagline?: string;
  source: 'builtin' | 'generated' | 'mock';
  questions: Question[];
}

export interface GameConfig {
  /** Display label, e.g. "The 80s". Empty until set. */
  theme: string;
  /** Free-form theme request sent to the server, e.g. "90s hip hop". */
  themeQuery: string;
  playerCount: number;
  /** Questions per player. */
  rounds: number;
  difficulty: Difficulty;
  turnSeconds: number;
  confirmSeconds: number;
  clipSeconds: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  /** Cut song clips from the opening (rarely sings the title) or from the loudest hook. */
  clipPosition: 'start' | 'hook';
}

export const DEFAULT_CONFIG: GameConfig = {
  theme: '',
  themeQuery: '',
  playerCount: 0,
  rounds: 2,
  difficulty: 'medium',
  turnSeconds: 20,
  confirmSeconds: 6,
  clipSeconds: 3,
  musicEnabled: true,
  sfxEnabled: true,
  clipPosition: 'start',
};

export const CONFIG_LIMITS = {
  players: { min: 1, max: 4 },
  rounds: { min: 1, max: 5 },
  turnSeconds: { min: 5, max: 60 },
  confirmSeconds: { min: 3, max: 15 },
  clipSeconds: { min: 2, max: 8 },
} as const;

