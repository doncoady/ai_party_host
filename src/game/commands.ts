import type { Difficulty } from './types.ts';

/**
 * Rule-based voice command parser.
 *
 * Everything a player can configure through the GUI can also be said out loud.
 * The parser is deterministic (so it can be unit tested) and tolerant of the
 * chatty transcripts a live speech model produces ("uh, let's do, like, three
 * players"). It returns zero or more commands because one utterance can carry
 * several settings: "two players, theme nineties, ten seconds per turn".
 */
export type VoiceCommand =
  | { type: 'set-theme'; theme: string }
  | { type: 'surprise-theme' }
  | { type: 'set-player-count'; count: number }
  | { type: 'set-rounds'; rounds: number }
  | { type: 'set-difficulty'; difficulty: Difficulty }
  | { type: 'set-turn-seconds'; seconds: number }
  | { type: 'set-clip-seconds'; seconds: number }
  | { type: 'music'; enabled: boolean }
  | { type: 'sfx'; enabled: boolean }
  | { type: 'mute'; muted: boolean }
  | { type: 'clip-position'; position: 'start' | 'hook' }
  | { type: 'quick-start' }
  | { type: 'start-game' }
  | { type: 'next' }
  | { type: 'pass' }
  | { type: 'replay' }
  | { type: 'hint' }
  | { type: 'scoreboard' }
  | { type: 'help' }
  | { type: 'play-again' }
  | { type: 'new-theme' }
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'final-answer'; answer: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, single: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60,
};

const NUMBER_PATTERN = '(\\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)';

export function wordToNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.toLowerCase().trim();
  if (/^\d+$/.test(value)) return Number(value);
  return value in NUMBER_WORDS ? NUMBER_WORDS[value] : null;
}

export function normalizeTranscript(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9'&+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLERS = new Set(['um', 'uh', 'hmm', 'hm', 'mm', 'er', 'ah', 'like', 'okay', 'ok', 'so', 'well', 'oh', 'yeah']);

/** True when the transcript is only noise/filler words. */
export function isFillerOnly(transcript: string) {
  const words = normalizeTranscript(transcript).split(' ').filter(Boolean);
  return words.length === 0 || words.every(word => FILLERS.has(word));
}

const THEME_STOP_PREFIX = /^(?:the\s+)?(?:theme|topic|category|subject|genre)\s*(?:is|to|of|should be|will be|for tonight is|:)?\s*/;
const THEME_STOP_SUFFIX = /\s*(?:please|tonight|for tonight|for the game|for this game|trivia|questions|theme|as the theme|as our theme)\s*$/;

function cleanTheme(raw: string) {
  let theme = raw.trim();
  for (let pass = 0; pass < 3; pass++) {
    theme = theme.replace(THEME_STOP_PREFIX, '').replace(THEME_STOP_SUFFIX, '').trim();
  }
  theme = theme.replace(/^(?:let's|lets|let us)\s+(?:do|play|go with|try)\s+/, '').replace(/^(?:do|play|go with|try|pick|choose|use)\s+/, '');
  theme = theme.replace(/^(?:some|a|an|the)\s+/, '').trim();
  return theme.slice(0, 60);
}

export function prettyTheme(theme: string) {
  const known: Array<[RegExp, string]> = [
    [/^(?:the\s+)?(?:19)?80s$|^(?:the\s+)?eighties$|^1980s$/, 'The 80s'],
    [/^(?:the\s+)?(?:19)?90s$|^(?:the\s+)?nineties$|^1990s$/, 'The 90s'],
    [/^(?:the\s+)?(?:19)?70s$|^(?:the\s+)?seventies$/, 'The 70s'],
    [/^(?:the\s+)?(?:20)?00s$|^(?:the\s+)?(?:two thousands|noughties|aughts)$/, 'The 2000s'],
    [/^(?:the\s+)?(?:20)?10s$|^(?:the\s+)?(?:twenty tens|tens)$/, 'The 2010s'],
  ];
  for (const [pattern, label] of known) {
    if (pattern.test(theme)) return label;
  }
  return theme
    .split(' ')
    .map(word => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Theme pills: music genres the streaming catalogs organise directly (decades, artists, moods also work by voice). */
export const GENRE_THEMES = [
  'Pop', 'Rock', 'Classic Rock', 'Hip Hop', 'R&B', 'Country', 'Dance', 'Electronic', 'Disco', 'Soul', 'Funk', 'Jazz', 'Blues',
  'Reggae', 'Metal', 'Punk', 'Indie', 'Alternative', 'Folk', 'Latin', 'K-Pop', 'Classical', 'Love Songs', 'One-Hit Wonders',
];
const SURPRISE_THEMES = [...GENRE_THEMES, 'The 70s', 'The 80s', 'The 90s', 'The 2000s'];

export function pickSurpriseTheme(random = Math.random) {
  return SURPRISE_THEMES[Math.floor(random() * SURPRISE_THEMES.length)];
}

export interface ParseContext {
  /** Phase-aware hints: when awaiting a theme, bare utterances are treated as the theme. */
  expecting?: 'theme' | 'player-count' | 'player-name' | 'answer' | 'confirmation' | 'none';
}

/**
 * Parse a transcript into commands. Order matters: navigation words are checked
 * before free-form settings so "next" never becomes a theme.
 */
export function parseVoiceCommands(transcript: string, context: ParseContext = {}): VoiceCommand[] {
  const text = normalizeTranscript(transcript);
  if (!text) return [];
  const commands: VoiceCommand[] = [];
  const padded = ` ${text} `;
  const has = (pattern: RegExp) => pattern.test(padded);

  // --- Global navigation / control phrases -------------------------------
  if (has(/\b(?:what can i say|help me|help|instructions|how do i play|what are the rules)\b/)) {
    commands.push({ type: 'help' });
  }
  if (has(/\b(?:scoreboard|what'?s the score|whats the score|read the scores?|scores? please|who'?s winning|who is winning|standings)\b/)) {
    commands.push({ type: 'scoreboard' });
  }
  if (has(/\b(?:play again|another game|another round|rematch|restart the game|start over|run it back)\b/)) {
    commands.push({ type: 'play-again' });
  }
  if (context.expecting !== 'theme' && has(/\b(?:new theme|different theme|change (?:the )?theme|switch (?:the )?theme|pick a new theme|another theme)\b/)) {
    const explicit = text.match(/(?:change|switch|set|make)\s+(?:the\s+)?theme\s+(?:to|into)\s+(.+)$/);
    if (explicit) commands.push({ type: 'set-theme', theme: prettyTheme(cleanTheme(explicit[1])) });
    else commands.push({ type: 'new-theme' });
  }
  if (has(/\b(?:mute everything|mute all|mute the game|silence)\b/)) commands.push({ type: 'mute', muted: true });
  if (has(/\b(?:unmute everything|unmute all|unmute the game|unmute)\b/)) commands.push({ type: 'mute', muted: false });
  if (has(/\b(?:turn off|stop|kill|mute|pause|disable|no more|silence|lose)\b[^.]*\bmusic\b/) || has(/\bmusic\b[^.]*\b(?:off|down)\b/)) {
    commands.push({ type: 'music', enabled: false });
  } else if (has(/\b(?:turn on|start|play|unmute|resume|enable|bring back)\b[^.]*\bmusic\b/) || has(/\bmusic\b[^.]*\b(?:on|back)\b/)) {
    commands.push({ type: 'music', enabled: true });
  }
  if (has(/\b(?:play|use|cut|clips? from)\b[^.]*\b(?:the )?(?:chorus|hook|loudest part)\b/)) commands.push({ type: 'clip-position', position: 'hook' });
  else if (has(/\b(?:play|use|cut|clips? from)\b[^.]*\b(?:the )?(?:intro|beginning|start|opening)s?\b[^.]*\b(?:of )?(?:the )?(?:songs?|clips?|tracks?)\b/) || has(/\bsong (?:intros|openings|beginnings)\b/)) commands.push({ type: 'clip-position', position: 'start' });
  if (has(/\b(?:turn off|disable|mute|no)\b[^.]*\b(?:sound effects|sfx|effects)\b/)) commands.push({ type: 'sfx', enabled: false });
  else if (has(/\b(?:turn on|enable|unmute)\b[^.]*\b(?:sound effects|sfx|effects)\b/)) commands.push({ type: 'sfx', enabled: true });

  if (has(/\b(?:play it again|play that again|replay|repeat (?:that|the (?:clip|question|clue|song))|one more time|say that again|again please|hear it again|can i hear (?:it|that) again)\b/)) {
    commands.push({ type: 'replay' });
  }
  if (has(/\b(?:hint|give me a (?:hint|clue)|clue please|a clue|what'?s the clue|read the clue)\b/) && context.expecting === 'answer') {
    commands.push({ type: 'hint' });
  }
  if (has(/\b(?:pass|skip(?: it| this| this one| question)?|i don'?t know|no idea|i give up|no clue|next question)\b/)) {
    commands.push({ type: 'pass' });
  } else if (has(/\b(?:next|continue|go on|move on|keep going|carry on|let'?s go on)\b/) && context.expecting !== 'answer') {
    commands.push({ type: 'next' });
  }
  if (has(/\b(?:quick start|use (?:the )?defaults|default settings|just start|skip (?:the )?setup)\b/)) {
    commands.push({ type: 'quick-start' });
  } else if (/^(?:okay |ok |alright |yes |yeah |um |uh )*(?:start the game|start game|start|let'?s (?:play|start|begin|go|do this|do it)|begin the game|begin|we'?re ready|ready to play|ready|go ahead and start|go|go for it)(?: now| already| please| the game)*$/.test(text)) {
    commands.push({ type: 'start-game' });
  }

  // --- Settings ----------------------------------------------------------
  const difficulty = text.match(/\b(easy|beginner|casual|medium|normal|regular|hard|difficult|brutal|expert|tough)\b(?:\s+(?:mode|difficulty|questions))?/);
  if (difficulty) {
    const word = difficulty[1];
    const mapped: Difficulty = /easy|beginner|casual/.test(word) ? 'easy' : /medium|normal|regular/.test(word) ? 'medium' : 'hard';
    if (/difficulty|mode|questions|make it|set/.test(text) || context.expecting !== 'answer') {
      commands.push({ type: 'set-difficulty', difficulty: mapped });
    }
  }

  const turnSeconds = text.match(new RegExp(`\\b${NUMBER_PATTERN}\\s*(?:seconds?|secs?)\\s*(?:to answer|per (?:turn|question|answer)|on the clock|timer|each|a turn|for each (?:turn|question))`))
    ?? text.match(new RegExp(`\\b(?:timer|clock|turn time|time limit|answer time)\\s*(?:to|of|is|at|=)?\\s*${NUMBER_PATTERN}\\s*(?:seconds?|secs?)?`));
  if (turnSeconds) {
    const seconds = wordToNumber(turnSeconds[1]);
    if (seconds !== null) commands.push({ type: 'set-turn-seconds', seconds });
  }

  const clipSeconds = text.match(new RegExp(`\\b${NUMBER_PATTERN}\\s*(?:second|sec)s?\\s*(?:clips?|song clips?|excerpts?|of music)`))
    ?? text.match(new RegExp(`\\b(?:clips?|song clips?|excerpts?)\\s*(?:of|to|is|at|should be|last)?\\s*${NUMBER_PATTERN}\\s*(?:seconds?|secs?)`));
  if (clipSeconds) {
    const seconds = wordToNumber(clipSeconds[1]);
    if (seconds !== null) commands.push({ type: 'set-clip-seconds', seconds });
  }

  const rounds = text.match(new RegExp(`\\b${NUMBER_PATTERN}\\s*(?:rounds?|questions? (?:each|per player|per person|a piece|apiece))`))
    ?? text.match(new RegExp(`\\b(?:rounds?|questions per player)\\s*(?:to|of|is|at|=|should be)?\\s*${NUMBER_PATTERN}\\b`));
  if (rounds) {
    const count = wordToNumber(rounds[1]);
    if (count !== null) commands.push({ type: 'set-rounds', rounds: count });
  }

  const players = text.match(new RegExp(`\\b${NUMBER_PATTERN}\\s*(?:players?|people|of us|contestants|teams|persons|folks|friends)\\b`))
    ?? text.match(new RegExp(`\\b(?:players?|people|contestants)\\s*(?:is|are|=|:|count(?: is)?|to)?\\s*${NUMBER_PATTERN}\\b`))
    ?? text.match(new RegExp(`\\b(?:there (?:are|is)|we have|we are|we're|it's|its|make it|set it to|let's do|lets do|i want|party of|table for)\\s*${NUMBER_PATTERN}\\b(?!\\s*(?:seconds?|secs?|rounds?|questions?))`));
  if (players) {
    const count = wordToNumber(players[1]);
    if (count !== null) commands.push({ type: 'set-player-count', count });
  } else if (has(/\b(?:just me|only me|solo|by myself|single player|one player|myself)\b/)) {
    commands.push({ type: 'set-player-count', count: 1 });
  } else if (has(/\b(?:the two of us|both of us|me and (?:my|a) \w+|two of us)\b/)) {
    commands.push({ type: 'set-player-count', count: 2 });
  } else if (context.expecting === 'player-count') {
    const bare = text.match(new RegExp(`^${NUMBER_PATTERN}$`));
    const count = wordToNumber(bare?.[1]);
    if (count !== null) commands.push({ type: 'set-player-count', count });
  }

  // --- Theme -------------------------------------------------------------
  if (has(/\b(?:surprise me|random theme|dealer'?s choice|you pick|you choose|anything|whatever you want|pick for (?:me|us))\b/)) {
    commands.push({ type: 'surprise-theme' });
  } else {
    const explicitTheme = text.match(/\b(?:(?:set|make|change|switch)\s+(?:the\s+)?theme\s+(?:to|into)|(?:the\s+)?theme\s+(?:is|should be|will be|of)|(?:the\s+)?(?:topic|category|subject)\s+(?:is|should be|will be|of)|let'?s\s+(?:play|do|go with|try)|i\s+(?:want|choose|pick|would like)|how about|what about|give (?:me|us)|we(?:'| wi)?ll take|pick)\s+(.+)$/);
    const trailingTheme = text.match(/^(.+?)\s+(?:trivia|questions|theme|as the theme|as our theme|for the theme|tonight)$/);
    const hasNavigation = commands.some(command => !command.type.startsWith('set-') && command.type !== 'music' && command.type !== 'sfx');
    let themeText: string | null = null;
    if (explicitTheme && !hasNavigation) themeText = explicitTheme[1];
    else if (trailingTheme && context.expecting !== 'answer' && commands.length === 0) themeText = trailingTheme[1];
    else if (context.expecting === 'theme' && commands.length === 0) themeText = text;
    else if (context.expecting === 'theme' && !hasNavigation) {
      // "eighties, two players, hard mode": strip the parsed settings and keep the rest as the theme.
      let remainder = text;
      for (const match of [players, rounds, turnSeconds, clipSeconds, difficulty]) {
        if (match) remainder = remainder.replace(match[0], ' ');
      }
      remainder = remainder
        .replace(/\b(?:music|sound effects|sfx)\b[^,]*/g, ' ')
        .replace(/\b(?:and|with|then|also|plus|please|mode|difficulty)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[,\s]+|[,\s]+$/g, '')
        .trim();
      if (remainder.length >= 2) themeText = remainder;
    }

    if (themeText) {
      // Strip any settings clauses that were already parsed out of the utterance.
      let cleaned = themeText
        .replace(new RegExp(`\\b(?:and|with|,)?\\s*${NUMBER_PATTERN}\\s*(?:players?|people|of us|contestants|rounds?|seconds?|secs?)\\b[^,]*`, 'g'), '')
        .replace(/\b(?:and|with)?\s*(?:easy|medium|hard|brutal|expert)\s*(?:mode|difficulty)?\b/g, '')
        .replace(/\b(?:please|thanks|thank you)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:and|with|,)\s*/, '')
        .replace(/[,\s]+$/, '');
      cleaned = cleanTheme(cleaned);
      if (cleaned && !/^(?:yes|no|next|pass|help|start|go|ready)$/.test(cleaned)) {
        commands.push({ type: 'set-theme', theme: prettyTheme(cleaned) });
      }
    }
  }

  // --- Confirmation ------------------------------------------------------
  if (context.expecting === 'confirmation') {
    if (has(/\b(?:yes|yeah|yep|yup|correct|affirmative|final answer|lock it in|lock it|that'?s my answer|that'?s it|i'?m sure|sure|confirm|absolutely|definitely|right)\b/)
      && !has(/\b(?:no|nope|not|don'?t|wait|change|different)\b/)) {
      commands.push({ type: 'yes' });
    } else if (has(/\b(?:no|nope|nah|negative|wait|hold on|change (?:it|that|my answer)|different answer|not that|take it back|scratch that|actually)\b/)) {
      commands.push({ type: 'no' });
    }
  }

  if (context.expecting === 'answer') {
    const finalAnswer = text.match(/^(.+?)[,\s]+(?:is my final answer|final answer|lock it in|and that'?s final)$/)
      ?? text.match(/^(?:final answer|my final answer is|lock in|i'?ll go with|i'?m going with|i'?m locking in)[,:\s]+(.+)$/);
    if (finalAnswer) commands.push({ type: 'final-answer', answer: finalAnswer[1].trim() });
  }

  return dedupe(commands);
}

function dedupe(commands: VoiceCommand[]) {
  const seen = new Set<string>();
  return commands.filter(command => {
    const key = command.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Strips leading "my name is" style phrases from a spoken name. */
export function spokenName(transcript: string) {
  return transcript
    .replace(/^\s*(?:um|uh|okay|ok|well|so)[,\s]+/i, '')
    .replace(/^\s*(?:my name is|my name's|i am|i'm|this is|it's|its|call me|they call me|name is|name's|the name is|i go by)\s+/i, '')
    .replace(/[.!?,]+$/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map(word => (word.length > 1 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(' ')
    .slice(0, 24);
}
