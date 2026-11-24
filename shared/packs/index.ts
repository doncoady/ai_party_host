import type { ThemePack } from '../../src/game/types.ts';
import { EIGHTIES_PACK } from './eighties.ts';
import { NINETIES_PACK } from './nineties.ts';

export const BUILTIN_PACKS: ThemePack[] = [EIGHTIES_PACK, NINETIES_PACK];

const ALIASES: Array<[RegExp, string]> = [
  [/^(?:the\s+)?(?:19)?80'?s$|^(?:the\s+)?eighties$|^1980s$|^80s (?:music|trivia|pop)$/i, 'builtin-80s'],
  [/^(?:the\s+)?(?:19)?90'?s$|^(?:the\s+)?nineties$|^1990s$|^90s (?:music|trivia|pop)$/i, 'builtin-90s'],
];

/** Returns a curated pack for well-known themes, or null when one must be generated. */
export function findBuiltinPack(theme: string): ThemePack | null {
  const cleaned = theme.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [pattern, id] of ALIASES) {
    if (pattern.test(cleaned)) return BUILTIN_PACKS.find(pack => pack.id === id) ?? null;
  }
  return BUILTIN_PACKS.find(pack => pack.theme.toLowerCase() === cleaned || pack.label.toLowerCase() === cleaned) ?? null;
}

export const DEFAULT_PACK = EIGHTIES_PACK;
