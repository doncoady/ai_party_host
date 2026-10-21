import type { Player } from './types.ts';

export function matchVoiceToPlayerCount(transcript: string): number | null {
  const match = transcript.toLowerCase().match(/\b(1|2|3|4|one|two|three|four)\b/);
  if (!match) return null;

  const spokenNumbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };
  return Number(match[1]) || spokenNumbers[match[1]];
}

export function matchVoiceToOption(transcript: string, options: string[]): number | null {
  const cleaned = normalizeAnswerPhrase(transcript);
  if (cleaned.length < 3) return null;

  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    const variants = [
      option,
      ...Array.from(option.matchAll(/\(([^)]+)\)/g), match => match[1]),
      ...option.split('/'),
    ].map(normalizeAnswerPhrase).filter(Boolean);
    const answerTerms = variants.flatMap(variant => variant.split(' ')).filter(term => term.length >= 4);
    if (variants.some(variant => phraseIncludes(cleaned, variant)) || answerTerms.some(term => phraseIncludes(cleaned, term))) {
      return index;
    }
  }

  return null;
}

function normalizeAnswerPhrase(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function phraseIncludes(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

export function getPlayerRank(score: number): { title: string; subtitle: string; icon: string } {
  if (score >= 12000) {
    return { title: 'TUBULAR 80s OVERLORD', subtitle: 'You own the entire neon decade! Marty McFly wishes he had your brain.', icon: '👑' };
  }
  if (score >= 7000) {
    return { title: 'RADICAL ARCADE CHAMPION', subtitle: 'Maximum high score energy. Someone get this player a neon fanny pack!', icon: '🕹️' };
  }
  if (score >= 3000) {
    return { title: 'TOTALLY AWESOME MALL RAT', subtitle: 'Respectable 80s fluency. You know your Cyndi Lauper from your Rick Astley.', icon: '📼' };
  }
  if (score >= 0) {
    return { title: 'CASSETTE TAPE ROOKIE', subtitle: 'A little rewinding with a pencil is clearly needed here.', icon: '📻' };
  }
  return { title: 'GAG ME WITH A SPOON', subtitle: 'Oof! Negative bank balance. You owe the studio $80s in late VHS rental fees.', icon: '💀' };
}
