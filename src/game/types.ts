export type QuestionType = 'TRIVIA' | 'SONG_CLIP' | 'SOUND_BYTE';

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
  borderHex: string;
  bgHex: string;
  avatar: string;
  correctCount: number;
}

export interface Question {
  id: string;
  category: string;
  title: string;
  question: string;
  hostClue: string;
  type: QuestionType;
  options: string[];
  correctIndex: number;
  basePoints: number;
  explanation: string;
  audioClipKey?: string;
  soundByteQuote?: string; // 80s movie / character quote
  characterSilhouetteHint?: string;
  hostIntroCommentary: string;
  hostCorrectRoast: string;
  hostWrongRoast: string;
  sponsorTitle?: string;
  sponsorCopy?: string;
}
