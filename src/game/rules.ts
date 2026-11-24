import type { Player, Question } from './types.ts';
import { normalizeTranscript, wordToNumber } from './commands.ts';

export function matchVoiceToPlayerCount(transcript: string): number | null {
  const match = normalizeTranscript(transcript).match(/\b(1|2|3|4|one|two|three|four)\b/);
  if (!match) return null;
  return wordToNumber(match[1]);
}

/** Words that are too generic to identify an answer on their own. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'who', 'you', 'your', 'are', 'was', 'were',
  'they', 'them', 'their', 'its', 'it', 'of', 'to', 'in', 'on', 'at', 'by', 'an', 'a', 'is', 'be', 'we', 'me',
  'my', 'our', 'not', 'don', 'dont', 'can', 'cant', 'just', 'get', 'got', 'take', 'make', 'like', 'want',
  'wanna', 'gonna', 'never', 'gonna', 'give', 'up', 'down', 'out', 'all', 'one', 'two', 'three', 'four',
  'song', 'movie', 'film', 'band', 'group', 'show', 'album', 'part', 'love', 'baby', 'girl', 'boy', 'man',
  'answer', 'think', 'guess', 'maybe', 'probably', 'definitely', 'final', 'yes', 'no', 'um', 'uh',
  'the', 'mr', 'mrs', 'dr', 'doctor', 'theme', 'name', 'time', 'day', 'night', 'world', 'life', 'way',
]);

const LETTER_ONLY_OPTION = /^[a-d]$/;

function normalizeAnswerPhrase(value: string) {
  return normalizeTranscript(value)
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseIncludes(text: string, phrase: string) {
  return phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
}

/** Expands "A-ha ("Take On Me")" into ["a ha take on me", "take on me", "a ha"]. */
export function answerVariants(option: string, aliases: string[] = []): string[] {
  const parenthetical = Array.from(option.matchAll(/\(([^)]+)\)/g), match => match[1]);
  const withoutParens = option.replace(/\([^)]*\)/g, ' ');
  const raw = [option, withoutParens, ...parenthetical, ...withoutParens.split('/'), ...aliases];
  const variants = raw.map(normalizeAnswerPhrase).filter(variant => variant.length >= 2);
  return Array.from(new Set(variants));
}

function significantTerms(variant: string) {
  return variant.split(' ').filter(term => term.length >= 3 && !STOP_WORDS.has(term));
}

/** Simple Damerau-free Levenshtein similarity (0..1) for fuzzy word matching. */
export function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distance = new Array<number>(rows * cols);
  for (let i = 0; i < rows; i++) distance[i * cols] = i;
  for (let j = 0; j < cols; j++) distance[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distance[i * cols + j] = Math.min(
        distance[(i - 1) * cols + j] + 1,
        distance[i * cols + j - 1] + 1,
        distance[(i - 1) * cols + j - 1] + cost,
      );
    }
  }
  return 1 - distance[rows * cols - 1] / Math.max(a.length, b.length);
}

function fuzzyTermHit(transcriptWords: string[], term: string) {
  if (term.length < 5) return transcriptWords.includes(term);
  return transcriptWords.some(word => word.length >= 4 && similarity(word, term) >= 0.8);
}

export interface AnswerMatch {
  optionIndex: number;
  score: number;
  matchedText: string;
}

/**
 * Scores every option against the transcript and returns the best match.
 *
 * Scoring tiers:
 *   3.x  a full option variant appears in the transcript ("take on me")
 *   2.x  every significant term of a variant appears (any order / fuzzy)
 *   1.x  a single distinctive term appears ("astley") — only for terms that are
 *        unique to that option and at least 5 characters long.
 */
export function matchVoiceToOption(transcript: string, options: string[], acceptedAnswers: Record<number, string[]> = {}): number | null {
  return findAnswerMatch(transcript, options, acceptedAnswers)?.optionIndex ?? null;
}

export function findAnswerMatch(transcript: string, options: string[], acceptedAnswers: Record<number, string[]> = {}): AnswerMatch | null {
  const cleaned = normalizeAnswerPhrase(transcript);
  if (cleaned.length < 2) return null;
  const transcriptWords = cleaned.split(' ');

  const allVariants = options.map((option, index) => answerVariants(option, acceptedAnswers[index] ?? []));
  const termOwners = new Map<string, Set<number>>();
  allVariants.forEach((variants, index) => {
    for (const variant of variants) {
      for (const term of significantTerms(variant)) {
        if (!termOwners.has(term)) termOwners.set(term, new Set());
        termOwners.get(term)!.add(index);
      }
    }
  });

  let best: AnswerMatch | null = null;
  const consider = (candidate: AnswerMatch) => {
    if (!best || candidate.score > best.score) best = candidate;
  };

  allVariants.forEach((variants, index) => {
    if (options[index] && LETTER_ONLY_OPTION.test(options[index].toLowerCase())) return;
    for (const variant of variants) {
      if (phraseIncludes(cleaned, variant)) {
        consider({ optionIndex: index, score: 3 + variant.length / 100, matchedText: variant });
        continue;
      }
      const terms = significantTerms(variant);
      if (terms.length === 0) continue;
      const hits = terms.filter(term => fuzzyTermHit(transcriptWords, term));
      if (hits.length === terms.length && terms.length >= 2) {
        consider({ optionIndex: index, score: 2 + hits.length / 10, matchedText: hits.join(' ') });
        continue;
      }
      for (const term of hits) {
        const owners = termOwners.get(term);
        const unique = owners?.size === 1;
        if (unique && (term.length >= 5 || terms.length === 1)) {
          consider({ optionIndex: index, score: 1 + term.length / 100, matchedText: term });
        }
      }
    }
  });

  return best;
}

export function acceptedAnswersByOption(question: Question): Record<number, string[]> {
  return question.acceptedAnswers?.length ? { [question.correctIndex]: question.acceptedAnswers } : {};
}

export function getPlayerRank(score: number): { title: string; subtitle: string; icon: string } {
  if (score >= 12000) {
    return { title: 'TRIVIA OVERLORD', subtitle: 'You own this entire theme. The host is slightly afraid of you.', icon: '👑' };
  }
  if (score >= 7000) {
    return { title: 'ARCADE CHAMPION', subtitle: 'Maximum high-score energy. Someone get this player a trophy.', icon: '🕹️' };
  }
  if (score >= 3000) {
    return { title: 'CERTIFIED MALL RAT', subtitle: 'Respectable fluency. You clearly paid attention at some point.', icon: '📼' };
  }
  if (score >= 0) {
    return { title: 'CASSETTE TAPE ROOKIE', subtitle: 'A little rewinding with a pencil is clearly needed here.', icon: '📻' };
  }
  return { title: 'GAG ME WITH A SPOON', subtitle: 'Negative bank balance. You owe the studio late rental fees.', icon: '💀' };
}

export function sortByScore(players: Player[]) {
  return [...players].sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);
}

export function scoreDelta(question: Question, outcome: 'correct' | 'wrong' | 'timeout' | 'pass', streakBefore: number) {
  if (outcome === 'timeout' || outcome === 'pass') return { delta: 0, bonus: 0 };
  if (outcome === 'wrong') return { delta: -question.basePoints, bonus: 0 };
  const bonus = streakBefore >= 1 ? Math.round(question.basePoints * 0.5) : 0;
  return { delta: question.basePoints + bonus, bonus };
}
