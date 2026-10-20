export type GameState = 
  | 'LOBBY' 
  | 'CATEGORY_SELECT' 
  | 'SPONSOR_BREAK' 
  | 'QUESTION_ACTIVE' 
  | 'PLAYER_BUZZED' 
  | 'ANSWER_REVEAL' 
  | 'ROUND_TRANSITION'
  | 'JACK_ATTACK' 
  | 'GAME_OVER';

export type QuestionType = 'TRIVIA' | 'SONG_CLIP' | 'SOUND_BYTE' | 'JACK_ATTACK';

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
  borderHex: string;
  bgHex: string;
  key: string; // Physical keyboard buzzer key e.g. 'q', 'p', 'z', 'm'
  voiceTriggerWords: string[];
  avatar: string; // 80s retro emoji/icon
  screwsRemaining: number;
  buzzCount: number;
  correctCount: number;
}

export interface Question {
  id: string;
  category: string;
  title: string;
  question: string;
  type: QuestionType;
  options: string[];
  correctIndex: number;
  basePoints: number;
  explanation: string;
  audioClipKey?: string; // Key in synthEngine for song clips
  soundByteQuote?: string; // 80s movie / character quote
  characterSilhouetteHint?: string;
  hostIntroCommentary: string;
  hostCorrectRoast: string;
  hostWrongRoast: string;
  sponsorTitle?: string;
  sponsorCopy?: string;
}

export interface JackAttackPair {
  clue: string;
  match: string;
  isCorrect: boolean;
}

export interface JackAttackRound {
  topic: string;
  clueRule: string;
  pairs: JackAttackPair[];
}

export interface BuzzerEvent {
  playerId: string;
  playerName: string;
  timestamp: number;
  viaVoice: boolean;
  phraseDetected?: string;
}
