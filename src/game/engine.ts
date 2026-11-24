import {
  CONFIG_LIMITS,
  DEFAULT_CONFIG,
  type GameConfig,
  type Player,
  type Question,
  type ThemePack,
} from './types.ts';
import { parseVoiceCommands, pickSurpriseTheme, isFillerOnly, spokenName, type VoiceCommand } from './commands.ts';
import { acceptedAnswersByOption, findAnswerMatch, scoreDelta, sortByScore } from './rules.ts';
import { lines } from './hostLines.ts';

/**
 * The game is a pure state machine. `reduce(state, event)` returns the next
 * state plus a list of side effects (speak, play clip, sound effect, ...).
 * The React layer runs the effects and feeds completion events back in, which
 * keeps the gameplay flow deterministic and testable without audio hardware.
 *
 * The game is Name That Tune: every question is an authentic song excerpt.
 * Questions are picked per round from the pack's pool based on which clips
 * have actually finished caching, so the show never plays a stand-in, and a
 * clip is never repeated across rematches.
 */
export type Phase =
  | 'THEME'
  | 'PLAYER_COUNT'
  | 'PLAYER_NAMES'
  | 'PREPARING'
  | 'INTRO'
  | 'QUESTION_INTRO'
  | 'CLUE'
  | 'ANSWERING'
  | 'JUDGING'
  | 'CONFIRMING'
  | 'REVEAL'
  | 'GAME_OVER';

export type Outcome = 'correct' | 'wrong' | 'timeout' | 'pass';

export interface PendingAnswer {
  transcript: string;
  optionIndex: number | null;
}

export interface TurnResult {
  playerId: string;
  playerName: string;
  questionId: string;
  outcome: Outcome;
  optionIndex: number | null;
  transcript: string;
  delta: number;
  bonus: number;
}

export interface Clock {
  kind: 'turn' | 'confirm';
  totalMs: number;
  remainingMs: number;
  /** Epoch ms when the clock (re)started, or null while paused. */
  startedAt: number | null;
  warned: boolean;
}

export interface GameState {
  phase: Phase;
  /** Increments on every phase transition; stale continuation events are ignored. */
  seq: number;
  config: GameConfig;
  players: Player[];
  setupPlayerIndex: number;
  pack: ThemePack | null;
  packStatus: 'idle' | 'loading' | 'ready' | 'error';
  packError: string | null;
  /** Questions scheduled so far (round by round, `players.length` per round). */
  questions: Question[];
  questionIndex: number;
  playerIndex: number;
  /** Rounds scheduled so far (each has `players.length` questions). */
  roundsPlanned: number;
  /** Question ids played in any game with this pack (rematches prefer fresh ones). */
  usedQuestionIds: string[];
  pendingAnswer: PendingAnswer | null;
  lastResult: TurnResult | null;
  results: TurnResult[];
  clock: Clock | null;
  /** Remaining turn time saved while the turn clock is parked (confirming, replaying). */
  turnRemainingMs: number | null;
  replaysUsed: number;
  hintsUsed: number;
  /** When PREPARING began, so a slow pipeline cannot stall the show forever. */
  prepStartedAt: number | null;
  /** PREPARING entered from inside a game (pool ran dry): resume the round instead of re-introducing. */
  resumeAfterPrep: boolean;
  /** A request for additional pool questions is in flight. */
  moreRequested: boolean;
  /** Transcript that could not be interpreted, for UI hints. */
  lastUnhandled: string | null;
  gamesPlayed: number;
  voiceReady: boolean;
}

export type GameEvent =
  | { type: 'BOOT'; voiceReady: boolean }
  | { type: 'VOICE_READY'; ready: boolean }
  | { type: 'TRANSCRIPT'; text: string; now?: number }
  | { type: 'COMMANDS'; commands: VoiceCommand[]; now?: number; source?: 'voice' | 'gui' }
  | { type: 'SET_PLAYER_NAME'; name: string; playerIndex?: number }
  | { type: 'APPLY_SETTINGS'; settings: Partial<GameConfig>; names?: string[]; start?: boolean }
  | { type: 'PACK_LOADING' }
  | { type: 'PACK_READY'; pack: ThemePack; now?: number }
  | { type: 'MEDIA_SETTINGS_CHANGED' }
  | { type: 'PACK_FAILED'; error: string; fallback?: ThemePack; now?: number }
  | { type: 'CLIP_UPDATED'; updates: Array<{ questionId: string; clip: Question['clip'] }>; now?: number }
  | { type: 'PREP_TICK'; now: number }
  | { type: 'SPEECH_DONE'; seq: number; continuation: Continuation; now?: number }
  | { type: 'MEDIA_DONE'; seq: number; failed?: boolean; now?: number }
  | { type: 'JUDGED'; seq: number; optionIndex: number | null; now?: number }
  | { type: 'CLOCK_EXPIRED'; seq: number; now: number }
  | { type: 'CLOCK_WARNING'; seq: number }
  | { type: 'ADVANCE'; seq?: number; now?: number }
  | { type: 'PLAY_AGAIN'; now?: number }
  | { type: 'RESET' };

export type Continuation =
  | 'start-clue'
  | 'begin-answering'
  | 'begin-confirm-clock'
  | 'resume-clock'
  | 'advance'
  | 'none';

export type SfxName =
  | 'correct' | 'wrong' | 'timeout' | 'lock-in' | 'buzz-in' | 'tick' | 'timer-warning'
  | 'reveal-drumroll' | 'applause' | 'fanfare' | 'intro-sting' | 'theme-set' | 'player-join'
  | 'game-start' | 'clip-whoosh' | 'transition' | 'streak' | 'scoreboard' | 'click';

export type Effect =
  | { type: 'speak'; text: string; style?: string; seq: number; continuation: Continuation; improv?: string; interrupt?: boolean; minDurationMs?: number }
  | { type: 'sfx'; name: SfxName }
  | { type: 'play-clip'; question: Question; seq: number; seconds: number }
  | { type: 'stop-audio' }
  | { type: 'load-pack'; themeQuery: string; difficulty: GameConfig['difficulty']; exclude: string[] }
  | { type: 'judge'; question: Question; transcript: string; seq: number }
  | { type: 'music'; enabled: boolean }
  | { type: 'sfx-enabled'; enabled: boolean }
  | { type: 'mute'; muted: boolean }
  | { type: 'celebrate' }
  | { type: 'live-theme'; theme: string };

export interface ReduceResult {
  state: GameState;
  effects: Effect[];
}

type PlayerStyle = Pick<Player, 'color' | 'borderHex' | 'bgHex' | 'avatar'>;
const PLAYER_STYLES: PlayerStyle[] = [
  { color: 'emerald', borderHex: '#10b981', bgHex: '#064e3b', avatar: '🎸' },
  { color: 'pink', borderHex: '#ec4899', bgHex: '#831843', avatar: '🕶️' },
  { color: 'cyan', borderHex: '#06b6d4', bgHex: '#0e7490', avatar: '🕹️' },
  { color: 'yellow', borderHex: '#eab308', bgHex: '#a16207', avatar: '📼' },
];

export const MAX_REPLAYS = 1;
export const MAX_HINTS = 1;
export const WARNING_SECONDS = 8;
/** Results stay on screen at least this long even if the host is quick. */
export const REVEAL_MIN_MS = 1500;
/** Longest we wait for round-one clips before starting with whatever is cached. */
export const PREP_MAX_WAIT_MS = 45_000;

export function createInitialState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'THEME',
    seq: 0,
    config: { ...DEFAULT_CONFIG },
    players: [],
    setupPlayerIndex: 0,
    pack: null,
    packStatus: 'idle',
    packError: null,
    questions: [],
    questionIndex: 0,
    playerIndex: 0,
    roundsPlanned: 0,
    usedQuestionIds: [],
    pendingAnswer: null,
    lastResult: null,
    results: [],
    clock: null,
    turnRemainingMs: null,
    replaysUsed: 0,
    hintsUsed: 0,
    prepStartedAt: null,
    resumeAfterPrep: false,
    moreRequested: false,
    lastUnhandled: null,
    gamesPlayed: 0,
    voiceReady: false,
    ...overrides,
  };
}

export function createPlayers(count: number, names: string[] = [], existing: Player[] = []): Player[] {
  return PLAYER_STYLES.slice(0, count).map((style, index) => ({
    id: `p${index + 1}`,
    name: names[index] ?? existing[index]?.name ?? '',
    score: 0,
    correctCount: 0,
    streak: 0,
    ...style,
  }));
}

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function currentQuestion(state: GameState): Question | null {
  return state.questions[state.questionIndex] ?? null;
}

export function activePlayer(state: GameState): Player | null {
  return state.players[state.playerIndex] ?? null;
}

export function currentRound(state: GameState) {
  return Math.floor(state.questionIndex / Math.max(1, state.players.length));
}

export function isPlayable(question: Question) {
  return question.clip?.status === 'ready';
}

export function clockRemainingMs(clock: Clock | null, now: number) {
  if (!clock) return null;
  if (clock.startedAt === null) return clock.remainingMs;
  return Math.max(0, clock.remainingMs - (now - clock.startedAt));
}

function resumeClock(clock: Clock | null, now: number): Clock | null {
  if (!clock || clock.startedAt !== null) return clock;
  return { ...clock, startedAt: now };
}

function speak(state: GameState, text: string, continuation: Continuation = 'none', extra: Partial<Extract<Effect, { type: 'speak' }>> = {}): Effect {
  return { type: 'speak', text, seq: state.seq, continuation, ...extra };
}

function loadPackEffect(state: GameState): Effect {
  return {
    type: 'load-pack',
    themeQuery: state.config.themeQuery || state.config.theme,
    difficulty: state.config.difficulty,
    exclude: state.usedQuestionIds,
  };
}

function transition(state: GameState, phase: Phase, changes: Partial<GameState> = {}): GameState {
  return { ...state, ...changes, phase, seq: state.seq + 1 };
}

function isSetupPhase(phase: Phase) {
  return phase === 'THEME' || phase === 'PLAYER_COUNT' || phase === 'PLAYER_NAMES' || phase === 'PREPARING';
}

function expectingFor(state: GameState) {
  switch (state.phase) {
    case 'THEME': return 'theme' as const;
    case 'PLAYER_COUNT': return 'player-count' as const;
    case 'PLAYER_NAMES': return 'player-name' as const;
    case 'ANSWERING': return 'answer' as const;
    case 'CONFIRMING': return 'confirmation' as const;
    default: return 'none' as const;
  }
}

/** Lines triggered directly by a player cut the host off; lines from async completions queue politely. */
function isUserInitiated(event: GameEvent) {
  return ['TRANSCRIPT', 'COMMANDS', 'SET_PLAYER_NAME', 'APPLY_SETTINGS', 'PLAY_AGAIN', 'RESET', 'BOOT'].includes(event.type);
}

export function reduce(state: GameState, event: GameEvent): ReduceResult {
  const now = 'now' in event && typeof event.now === 'number' ? event.now : Date.now();
  const result = reduceInner(state, event, now);
  const interrupt = isUserInitiated(event);
  return {
    state: result.state,
    effects: result.effects.map(effect => (effect.type === 'speak' && effect.interrupt === undefined ? { ...effect, interrupt } : effect)),
  };
}

function reduceInner(state: GameState, event: GameEvent, now: number): ReduceResult {
  switch (event.type) {
    case 'BOOT':
      return boot(state, event.voiceReady);
    case 'VOICE_READY':
      return { state: { ...state, voiceReady: event.ready }, effects: [] };
    case 'RESET':
      return { state: createInitialState({ voiceReady: state.voiceReady, gamesPlayed: state.gamesPlayed, seq: state.seq + 1 }), effects: [] };
    case 'TRANSCRIPT':
      return handleTranscript(state, event.text, now);
    case 'COMMANDS':
      return applyCommands(state, event.commands, now, event.source ?? 'voice');
    case 'SET_PLAYER_NAME':
      return setPlayerName(state, event.name, now, event.playerIndex);
    case 'APPLY_SETTINGS':
      return applySettings(state, event.settings, now, event.names, event.start);
    case 'PACK_LOADING':
      return { state: { ...state, packStatus: state.pack ? state.packStatus : 'loading', packError: null }, effects: [] };
    case 'MEDIA_SETTINGS_CHANGED':
      // Rebuild the pack with the new media sources; the game picks it up when it arrives.
      if (!state.config.theme) return { state, effects: [] };
      return { state: { ...state, moreRequested: true }, effects: [loadPackEffect(state)] };
    case 'PACK_READY':
      return packReady(state, event.pack, now);
    case 'PACK_FAILED':
      return packFailed(state, event.error, now, event.fallback);
    case 'CLIP_UPDATED':
      return clipsUpdated(state, event.updates, now);
    case 'PREP_TICK':
      return state.phase === 'PREPARING' ? maybeStart(state, now, []) : { state, effects: [] };
    case 'SPEECH_DONE':
      if (event.seq !== state.seq) return { state, effects: [] };
      return continueAfterSpeech(state, event.continuation, now);
    case 'MEDIA_DONE':
      if (event.seq !== state.seq || state.phase !== 'CLUE') return { state, effects: [] };
      if (event.failed) return clueFailed(state, now);
      return beginAnswering(state, now);
    case 'JUDGED':
      if (event.seq !== state.seq || state.phase !== 'JUDGING') return { state, effects: [] };
      return askForConfirmation(state, { ...state.pendingAnswer!, optionIndex: event.optionIndex }, now);
    case 'CLOCK_EXPIRED':
      if (event.seq !== state.seq) return { state, effects: [] };
      return clockExpired(state, now);
    case 'CLOCK_WARNING':
      if (event.seq !== state.seq || !state.clock || state.clock.warned) return { state, effects: [] };
      return { state: { ...state, clock: { ...state.clock, warned: true } }, effects: [{ type: 'sfx', name: 'timer-warning' }] };
    case 'ADVANCE':
      if (event.seq !== undefined && event.seq !== state.seq) return { state, effects: [] };
      if (state.phase !== 'REVEAL') return { state, effects: [] };
      return advance(state, now);
    case 'PLAY_AGAIN':
      return playAgain(state, now);
    default:
      return { state, effects: [] };
  }
}

function boot(state: GameState, voiceReady: boolean): ReduceResult {
  const next = { ...state, voiceReady };
  return {
    state: next,
    effects: [
      { type: 'music', enabled: next.config.musicEnabled },
      { type: 'sfx', name: 'intro-sting' },
      speak(next, voiceReady ? lines.welcome() : lines.welcomeNoMic()),
    ],
  };
}

// ---------------------------------------------------------------------------
// Transcripts & commands
// ---------------------------------------------------------------------------
function handleTranscript(state: GameState, text: string, now: number): ReduceResult {
  const trimmed = text.trim();
  if (!trimmed || isFillerOnly(trimmed)) return { state, effects: [] };

  const commands = parseVoiceCommands(trimmed, { expecting: expectingFor(state) });
  if (state.phase === 'THEME' && commands.length === 1 && commands[0].type === 'set-theme' && /^(?:[1-4]|one|two|three|four)$/i.test(trimmed)) {
    return applyCommands(state, parseVoiceCommands(trimmed, { expecting: 'player-count' }), now, 'voice');
  }

  // Player names are free text: only obvious commands win over a name.
  if (state.phase === 'PLAYER_NAMES') {
    const explicitCount = /\b(?:players?|people|of us|contestants)\b/i.test(trimmed);
    const override = commands.find(command => ['help', 'scoreboard', 'quick-start', 'new-theme', 'music', 'mute', 'sfx'].includes(command.type)
      || (command.type === 'set-player-count' && explicitCount));
    if (override) return applyCommands(state, commands.filter(command => command.type !== 'set-player-count' || explicitCount), now, 'voice');
    return setPlayerName(state, trimmed, now);
  }

  // Mid-game, settings changes must be explicit ("change the theme to…", "three players") so answers are never mistaken for commands.
  const explicitSetting = (command: VoiceCommand) =>
    ((command.type === 'set-theme' || command.type === 'new-theme') && /\btheme\b/i.test(trimmed))
    || (command.type === 'set-player-count' && /\b(?:players?|contestants)\b/i.test(trimmed));

  if (state.phase === 'ANSWERING') {
    const control = commands.filter(command => ['pass', 'replay', 'hint', 'help', 'scoreboard', 'final-answer', 'music', 'mute', 'sfx'].includes(command.type) || explicitSetting(command));
    if (control.length) return applyCommands(state, control, now, 'voice');
    return heardAnswer(state, trimmed, now);
  }

  if (state.phase === 'CONFIRMING') {
    const decision = commands.find(command => command.type === 'yes' || command.type === 'no');
    if (decision?.type === 'yes') return confirmAnswer(state, now);
    if (decision?.type === 'no') return rejectAnswer(state, trimmed, now);
    const control = commands.filter(command => ['pass', 'help', 'scoreboard', 'music', 'mute', 'sfx'].includes(command.type) || explicitSetting(command));
    if (control.length) return applyCommands(state, control, now, 'voice');
    const question = currentQuestion(state);
    if (question) {
      const match = findAnswerMatch(trimmed, question.options, acceptedAnswersByOption(question));
      if (match && match.optionIndex !== state.pendingAnswer?.optionIndex) {
        return askForConfirmation(state, { transcript: trimmed, optionIndex: match.optionIndex }, now);
      }
    }
    return { state: { ...state, lastUnhandled: trimmed }, effects: [speak(state, lines.confirmAgain(state.pendingAnswer?.transcript ?? ''), 'begin-confirm-clock')] };
  }

  if (commands.length === 0) return unhandled(state, trimmed);
  return applyCommands(state, commands, now, 'voice');
}

function unhandled(state: GameState, transcript: string): ReduceResult {
  const next = { ...state, lastUnhandled: transcript };
  switch (state.phase) {
    case 'THEME':
      return { state: next, effects: [speak(next, lines.themeRetry())] };
    case 'PLAYER_COUNT':
      return { state: next, effects: [speak(next, lines.playerCountRetry())] };
    default:
      return { state: next, effects: [] };
  }
}

/** Which setup step is still missing, or READY when everything is configured. */
function setupPhaseFor(state: GameState): Phase | 'READY' {
  if (!state.config.theme) return 'THEME';
  if (!state.players.length) return 'PLAYER_COUNT';
  if (state.players.some(player => !player.name)) return 'PLAYER_NAMES';
  return 'READY';
}

function applyCommands(state: GameState, commands: VoiceCommand[], now: number, source: 'voice' | 'gui'): ReduceResult {
  let current = state;
  const effects: Effect[] = [];
  const announcements: string[] = [];
  let wantsStart = false;

  for (const command of commands) {
    const result = applyCommand(current, command, now, source);
    current = result.state;
    effects.push(...result.effects);
    if (result.announce) announcements.push(result.announce);
    if (result.start) wantsStart = true;
  }

  if (isSetupPhase(current.phase) && current.phase !== 'PREPARING') {
    const target = setupPhaseFor(current);
    if (target === 'READY' || wantsStart) {
      const started = tryStart(current, announcements, now);
      return { state: started.state, effects: [...effects, ...started.effects] };
    }
    if (target !== current.phase) current = transition(current, target);
  } else if (wantsStart) {
    const started = tryStart(current, announcements, now);
    return { state: started.state, effects: [...effects, ...started.effects] };
  }

  if (announcements.length) {
    const prompt = nextSetupPrompt(current);
    effects.push(speak(current, [...announcements, prompt].filter(Boolean).join(' '), continuationFor(current)));
  }
  return { state: current, effects };
}

interface CommandResult {
  state: GameState;
  effects: Effect[];
  announce?: string;
  start?: boolean;
}

function applyCommand(state: GameState, command: VoiceCommand, now: number, source: 'voice' | 'gui'): CommandResult {
  const question = currentQuestion(state);
  const player = activePlayer(state);
  switch (command.type) {
    case 'set-theme':
    case 'surprise-theme': {
      const theme = command.type === 'surprise-theme' ? pickSurpriseTheme() : command.theme;
      const changedMidGame = !isSetupPhase(state.phase);
      const config = { ...state.config, theme, themeQuery: theme };
      const players = state.players.map(entry => ({ ...entry, score: 0, correctCount: 0, streak: 0 }));
      const phase: Phase = changedMidGame ? 'PREPARING' : state.phase === 'THEME' ? 'PLAYER_COUNT' : state.phase;
      const next: GameState = {
        ...state,
        config,
        players,
        pack: null,
        packStatus: 'loading',
        packError: null,
        questions: [],
        questionIndex: 0,
        playerIndex: 0,
        roundsPlanned: 0,
        usedQuestionIds: [],
        results: [],
        lastResult: null,
        pendingAnswer: null,
        clock: null,
        turnRemainingMs: null,
        prepStartedAt: changedMidGame ? now : null,
        resumeAfterPrep: false,
        moreRequested: false,
        phase,
        seq: state.seq + 1,
      };
      return {
        state: next,
        effects: [
          { type: 'stop-audio' },
          { type: 'sfx', name: 'theme-set' },
          loadPackEffect(next),
          { type: 'live-theme', theme },
        ],
        announce: changedMidGame ? lines.themeChangedMidGame(theme) : lines.themeLocked(theme),
      };
    }
    case 'set-player-count': {
      const count = clamp(command.count, CONFIG_LIMITS.players);
      if (command.count !== count) return { state, effects: [], announce: lines.playerCountOutOfRange(command.count) };
      if (!isSetupPhase(state.phase)) return { state, effects: [], announce: lines.cannotChangeMidGame('the player count') };
      const players = createPlayers(count, [], state.players);
      const firstUnnamed = players.findIndex(entry => !entry.name);
      const next: GameState = {
        ...state,
        config: { ...state.config, playerCount: count },
        players,
        setupPlayerIndex: Math.max(0, firstUnnamed),
        phase: state.phase === 'THEME' ? 'THEME' : firstUnnamed === -1 && state.phase === 'PREPARING' ? 'PREPARING' : 'PLAYER_NAMES',
        seq: state.seq + 1,
      };
      return { state: next, effects: [{ type: 'sfx', name: 'player-join' }], announce: lines.playerCountSet(count) };
    }
    case 'set-rounds': {
      const rounds = clamp(command.rounds, CONFIG_LIMITS.rounds);
      return { state: { ...state, config: { ...state.config, rounds } }, effects: [], announce: lines.roundsSet(rounds) };
    }
    case 'set-difficulty':
      return { state: { ...state, config: { ...state.config, difficulty: command.difficulty } }, effects: [], announce: lines.difficultySet(command.difficulty) };
    case 'set-turn-seconds': {
      const seconds = clamp(command.seconds, CONFIG_LIMITS.turnSeconds);
      return { state: { ...state, config: { ...state.config, turnSeconds: seconds } }, effects: [], announce: lines.turnSecondsSet(seconds) };
    }
    case 'set-clip-seconds': {
      const seconds = clamp(command.seconds, CONFIG_LIMITS.clipSeconds);
      return { state: { ...state, config: { ...state.config, clipSeconds: seconds } }, effects: [], announce: lines.clipSecondsSet(seconds) };
    }
    case 'music':
      return {
        state: { ...state, config: { ...state.config, musicEnabled: command.enabled } },
        effects: [{ type: 'music', enabled: command.enabled }],
        announce: source === 'voice' ? lines.musicToggled(command.enabled) : undefined,
      };
    case 'sfx':
      return {
        state: { ...state, config: { ...state.config, sfxEnabled: command.enabled } },
        effects: [{ type: 'sfx-enabled', enabled: command.enabled }],
        announce: source === 'voice' ? lines.sfxToggled(command.enabled) : undefined,
      };
    case 'mute':
      return { state, effects: [{ type: 'mute', muted: command.muted }] };
    case 'clip-position': {
      if (state.config.clipPosition === command.position) return { state, effects: [] };
      const next: GameState = { ...state, config: { ...state.config, clipPosition: command.position } };
      // Clips are cut differently now: rebuild the pack's clip jobs (cached sources make this quick).
      const effects: Effect[] = next.config.theme ? [loadPackEffect(next)] : [];
      return { state: effects.length ? { ...next, moreRequested: true } : next, effects, announce: source === 'voice' ? lines.clipPositionSet(command.position) : undefined };
    }
    case 'help':
      return { state, effects: [speak(state, lines.help(state.phase, state.config.theme), continuationFor(state))] };
    case 'scoreboard':
      return { state, effects: [{ type: 'sfx', name: 'scoreboard' }, speak(state, lines.scoreboard(sortByScore(state.players)), continuationFor(state))] };
    case 'quick-start':
      return { state: quickStartDefaults(state), effects: [], start: true };
    case 'start-game':
      return { state, effects: [], start: true };
    case 'next':
      if (state.phase === 'REVEAL') return advance(state, now);
      if (state.phase === 'PLAYER_NAMES' && player) return { state, effects: [], announce: lines.stillNeedName(state.setupPlayerIndex + 1) };
      return { state, effects: [] };
    case 'pass':
      if (state.phase === 'ANSWERING' || state.phase === 'CONFIRMING' || state.phase === 'JUDGING') return resolveTurn(state, 'pass', null, '', now);
      return { state, effects: [] };
    case 'replay':
      return replay(state, now);
    case 'hint':
      return hint(state, now);
    case 'play-again':
      if (state.phase === 'GAME_OVER') return playAgain(state, now);
      return { state, effects: [] };
    case 'new-theme': {
      const next = transition(createInitialState({ voiceReady: state.voiceReady, gamesPlayed: state.gamesPlayed, seq: state.seq }), 'THEME');
      return { state: next, effects: [{ type: 'stop-audio' }, { type: 'sfx', name: 'transition' }, speak(next, lines.askTheme())] };
    }
    case 'final-answer':
      if (state.phase === 'ANSWERING' && question) {
        const match = findAnswerMatch(command.answer, question.options, acceptedAnswersByOption(question));
        return resolveTurn(state, match ? 'correct' : 'wrong', match?.optionIndex ?? null, command.answer, now, match?.optionIndex === question.correctIndex);
      }
      return { state, effects: [] };
    case 'yes':
      if (state.phase === 'CONFIRMING') return confirmAnswer(state, now);
      return { state, effects: [] };
    case 'no':
      if (state.phase === 'CONFIRMING') return rejectAnswer(state, '', now);
      return { state, effects: [] };
    default:
      return { state, effects: [] };
  }
}

function continuationFor(state: GameState): Continuation {
  switch (state.phase) {
    case 'REVEAL': return 'advance';
    case 'CONFIRMING': return 'begin-confirm-clock';
    default: return 'none';
  }
}

function quickStartDefaults(state: GameState): GameState {
  const config = {
    ...state.config,
    theme: state.config.theme || 'The 80s',
    themeQuery: state.config.themeQuery || 'The 80s',
    playerCount: state.config.playerCount || Math.max(1, state.players.length),
  };
  const players = createPlayers(config.playerCount, [], state.players).map((player, index) => ({ ...player, name: player.name || `Player ${index + 1}` }));
  return { ...state, config, players, packStatus: state.pack ? 'ready' : state.packStatus };
}

function nextSetupPrompt(state: GameState): string {
  switch (state.phase) {
    case 'THEME':
      return lines.askTheme();
    case 'PLAYER_COUNT':
      return lines.askPlayerCount();
    case 'PLAYER_NAMES': {
      const index = state.players.findIndex(player => !player.name);
      return index === -1 ? lines.readyToStart() : lines.askName(index + 1, index === 0);
    }
    default:
      return '';
  }
}

function setPlayerName(state: GameState, rawName: string, now: number, playerIndex = state.setupPlayerIndex): ReduceResult {
  if (state.phase !== 'PLAYER_NAMES' && state.phase !== 'PREPARING') return { state, effects: [] };
  if (!state.players.length) return { state, effects: [speak(state, lines.askPlayerCount())] };
  const name = spokenName(rawName);
  if (!name) return { state, effects: [speak(state, lines.nameRetry())] };
  const players = state.players.map((player, index) => (index === playerIndex ? { ...player, name } : player));
  const nextIndex = players.findIndex((player, index) => index > playerIndex && !player.name);
  const allNamed = players.every(player => player.name);
  const next: GameState = { ...state, players, setupPlayerIndex: nextIndex === -1 ? playerIndex : nextIndex };
  if (allNamed) return tryStart(next, [lines.nameAccepted(name)], now);
  return {
    state: next,
    effects: [{ type: 'sfx', name: 'player-join' }, speak(next, `${lines.nameAccepted(name)} ${lines.askName(next.setupPlayerIndex + 1, false)}`)],
  };
}

function applySettings(state: GameState, settings: Partial<GameConfig>, now: number, names?: string[], start?: boolean): ReduceResult {
  let current = state;
  const effects: Effect[] = [];
  const commands: VoiceCommand[] = [];
  if (settings.theme && settings.theme !== state.config.theme) commands.push({ type: 'set-theme', theme: settings.theme });
  if (settings.playerCount && settings.playerCount !== state.config.playerCount) commands.push({ type: 'set-player-count', count: settings.playerCount });
  if (settings.rounds !== undefined) commands.push({ type: 'set-rounds', rounds: settings.rounds });
  if (settings.difficulty) commands.push({ type: 'set-difficulty', difficulty: settings.difficulty });
  if (settings.turnSeconds !== undefined) commands.push({ type: 'set-turn-seconds', seconds: settings.turnSeconds });
  if (settings.clipSeconds !== undefined) commands.push({ type: 'set-clip-seconds', seconds: settings.clipSeconds });
  if (settings.musicEnabled !== undefined) commands.push({ type: 'music', enabled: settings.musicEnabled });
  if (settings.sfxEnabled !== undefined) commands.push({ type: 'sfx', enabled: settings.sfxEnabled });
  if (settings.clipPosition !== undefined && settings.clipPosition !== state.config.clipPosition) commands.push({ type: 'clip-position', position: settings.clipPosition });

  for (const command of commands) {
    const result = applyCommand(current, command, now, 'gui');
    current = result.state;
    effects.push(...result.effects);
  }
  if (settings.confirmSeconds !== undefined) {
    current = { ...current, config: { ...current.config, confirmSeconds: clamp(settings.confirmSeconds, CONFIG_LIMITS.confirmSeconds) } };
  }
  if (names && current.players.length) {
    current = { ...current, players: current.players.map((player, index) => (names[index]?.trim() ? { ...player, name: spokenName(names[index]) } : player)) };
  }
  if (start) {
    const started = tryStart(current, [], now);
    return { state: started.state, effects: [...effects, ...started.effects] };
  }
  if (isSetupPhase(current.phase) && current.phase !== 'PREPARING') {
    const prompt = nextSetupPrompt(current);
    if (prompt) effects.push(speak(current, prompt));
  }
  return { state: current, effects };
}

// ---------------------------------------------------------------------------
// Starting the show
// ---------------------------------------------------------------------------
/** Start the game if everything is configured, otherwise ask for what is missing. */
function tryStart(state: GameState, announcements: string[], now: number): ReduceResult {
  if (!isSetupPhase(state.phase)) return { state, effects: [] };
  if (!state.config.theme) {
    const next = transition(state, 'THEME');
    return { state: next, effects: [speak(next, [...announcements, lines.askTheme()].join(' '))] };
  }
  if (!state.players.length) {
    const next = transition(state, 'PLAYER_COUNT');
    return { state: next, effects: [speak(next, [...announcements, lines.askPlayerCount()].join(' '))] };
  }
  const unnamed = state.players.findIndex(player => !player.name);
  if (unnamed !== -1) {
    const next = transition(state, 'PLAYER_NAMES', { setupPlayerIndex: unnamed });
    return { state: next, effects: [speak(next, [...announcements, lines.askName(unnamed + 1, unnamed === 0)].join(' '))] };
  }
  const prepping = state.phase === 'PREPARING' ? state : transition(state, 'PREPARING', { prepStartedAt: state.prepStartedAt ?? now });
  const effects: Effect[] = [];
  if (state.phase !== 'PREPARING') effects.push({ type: 'sfx', name: 'transition' });
  if (state.packStatus === 'idle' || state.packStatus === 'error') effects.push(loadPackEffect(state));
  const started = maybeStart({ ...prepping, packStatus: state.packStatus === 'idle' ? 'loading' : prepping.packStatus }, now, announcements);
  return { state: started.state, effects: [...effects, ...started.effects] };
}

/** Unused, playable-or-pending questions left in the pool. */
function poolDepth(state: GameState) {
  const used = new Set(state.usedQuestionIds);
  const scheduled = new Set(state.questions.map(question => question.id));
  return (state.pack?.questions ?? []).filter(question => !used.has(question.id) && !scheduled.has(question.id) && question.clip?.status !== 'failed').length;
}

/** Asks the server for more pool when the remaining game could run dry (never repeats a clip). */
function topUpEffects(state: GameState): Effect[] {
  if (!state.pack || state.moreRequested || state.pack.source === 'mock') return [];
  const players = Math.max(1, state.players.length);
  const roundsLeft = Math.max(0, state.config.rounds - state.roundsPlanned);
  // Keep one spare round in reserve so a rematch can start without waiting.
  const need = (roundsLeft + 1) * players;
  return poolDepth(state) < need ? [loadPackEffect(state)] : [];
}

/** In PREPARING: start (or resume) as soon as the next round can be filled with cached clips, or the wait runs out. */
function maybeStart(state: GameState, now: number, announcements: string[]): ReduceResult {
  if (state.phase !== 'PREPARING') return { state, effects: [] };
  if (state.packStatus !== 'ready' || !state.pack) {
    return announcements.length ? { state, effects: [speak(state, [...announcements, lines.preparing(state.config.theme)].join(' '))] } : { state, effects: [] };
  }
  const waited = now - (state.prepStartedAt ?? now);
  const plan = planRound(state, waited >= PREP_MAX_WAIT_MS);
  if (plan && plan.questions.length >= state.players.length) {
    const topUp = topUpEffects({ ...state, roundsPlanned: state.resumeAfterPrep ? state.roundsPlanned : 1 });
    const started = state.resumeAfterPrep ? resumeRound(state, plan, announcements, now) : startGame(state, plan, announcements);
    return { state: topUp.length ? { ...started.state, moreRequested: true } : started.state, effects: [...started.effects, ...topUp] };
  }
  const effects: Effect[] = [];
  // Pool too small for even one round and nothing caching: fetch more before the budget runs out.
  const pending = state.pack.questions.some(question => question.clip?.status === 'pending');
  if (!pending && !state.moreRequested) {
    effects.push(loadPackEffect(state));
    state = { ...state, moreRequested: true };
  }
  if (waited >= PREP_MAX_WAIT_MS) {
    if (plan && plan.questions.length) {
      const started = state.resumeAfterPrep ? resumeRound(state, plan, announcements, now) : startGame(state, plan, announcements);
      return { state: started.state, effects: [...effects, ...started.effects] };
    }
    if (state.resumeAfterPrep) return finishGame(state, lines.noMoreClips());
    const next = transition({ ...state, packStatus: 'error', packError: 'No playable clips', pack: null, prepStartedAt: null }, 'THEME', { config: { ...state.config, theme: '', themeQuery: '' } });
    return { state: next, effects: [...effects, speak(next, lines.noClipsAvailable(state.config.theme))] };
  }
  if (announcements.length) effects.push(speak(state, [...announcements, lines.preparing(state.config.theme)].join(' ')));
  return { state, effects };
}

/** Continues a game whose pool ran dry once more clips have been cached. */
function resumeRound(state: GameState, plan: RoundChoice, announcements: string[], now: number): ReduceResult {
  const next: GameState = {
    ...state,
    questions: [...state.questions, ...plan.questions],
    roundsPlanned: state.roundsPlanned + 1,
    resumeAfterPrep: false,
    prepStartedAt: null,
  };
  const presented = presentQuestion(next, now);
  if (announcements.length) return { state: presented.state, effects: [speak(presented.state, announcements.join(' ')), ...presented.effects] };
  return presented;
}

interface RoundChoice {
  questions: Question[];
}

/**
 * Picks `players.length` playable questions for a round. Rounds alternate
 * between Name That Tune and Who Said It; a kind is only used when enough of
 * its clips are cached.
 */
/**
 * Picks `players.length` playable questions for a round, in pack order.
 * Clips are never repeated, in this game or a rematch; with `allowPartial`
 * a short round is accepted once the wait budget is spent.
 */
export function planRound(state: GameState, allowPartial = false): RoundChoice | null {
  const pack = state.pack;
  if (!pack) return null;
  const need = Math.max(1, state.players.length);
  const scheduled = new Set(state.questions.map(question => question.id));
  const used = new Set(state.usedQuestionIds);
  const pool = pack.questions.filter(question => !scheduled.has(question.id) && !used.has(question.id) && isPlayable(question));
  if (pool.length >= need) return { questions: pool.slice(0, need) };
  if (!allowPartial || !pool.length) return null;
  return { questions: pool };
}

function startGame(state: GameState, plan: RoundChoice, announcements: string[]): ReduceResult {
  const next = transition(state, 'INTRO', {
    questions: plan.questions,
    roundsPlanned: 1,
    questionIndex: 0,
    playerIndex: 0,
    results: [],
    lastResult: null,
    pendingAnswer: null,
    replaysUsed: 0,
    hintsUsed: 0,
    prepStartedAt: null,
    resumeAfterPrep: false,
    players: state.players.map(player => ({ ...player, score: 0, correctCount: 0, streak: 0 })),
  });
  const intro = lines.gameIntro(next.config.theme, next.players);
  return {
    state: next,
    effects: [
      { type: 'sfx', name: 'game-start' },
      speak(next, [...announcements, intro].join(' '), 'advance', { improv: lines.introImprov(next.config.theme, next.players), minDurationMs: 1500 }),
    ],
  };
}

function packReady(state: GameState, pack: ThemePack, now: number): ReduceResult {
  // Extensions (more pool, new media sources) merge into the current pool.
  const merged: ThemePack = state.pack && state.pack.theme.toLowerCase() === pack.theme.toLowerCase()
    ? { ...state.pack, ...pack, questions: [...state.pack.questions, ...pack.questions.filter(question => !state.pack!.questions.some(existing => existing.id === question.id))] }
    : pack;
  const next: GameState = { ...state, pack: merged, packStatus: 'ready', packError: null, moreRequested: false };
  if (state.phase === 'PREPARING') return maybeStart(next, now, []);
  return { state: next, effects: [] };
}

function packFailed(state: GameState, error: string, now: number, fallback?: ThemePack): ReduceResult {
  if (fallback) {
    const config = { ...state.config, theme: fallback.label, themeQuery: fallback.label };
    const next: GameState = { ...state, config, pack: fallback, packStatus: 'ready', packError: error };
    const line = lines.packFallback(state.config.theme, fallback.label);
    if (state.phase === 'PREPARING') {
      const started = maybeStart(next, now, [line]);
      return started.effects.some(effect => effect.type === 'speak') ? started : { state: started.state, effects: [speak(started.state, line), ...started.effects] };
    }
    return { state: next, effects: [speak(next, line)] };
  }
  if (state.pack) {
    // An extension failed: keep playing with what we have.
    return { state: { ...state, moreRequested: false, packError: error }, effects: [] };
  }
  const next = transition({ ...state, packStatus: 'error', packError: error, pack: null, prepStartedAt: null, moreRequested: false }, 'THEME', { config: { ...state.config, theme: '', themeQuery: '' } });
  return { state: next, effects: [speak(next, lines.packFailed(state.config.theme, summarizeError(error)))] };
}

/** Trims server error text to something a host can say. */
function summarizeError(error: string) {
  const cleaned = error.replace(/\s+/g, ' ').trim();
  if (!cleaned || /^request failed/i.test(cleaned)) return undefined;
  return cleaned.length > 90 ? `${cleaned.slice(0, 90)}…` : cleaned;
}

function clipsUpdated(state: GameState, updates: Array<{ questionId: string; clip: Question['clip'] }>, now: number): ReduceResult {
  if (!updates.length) return { state, effects: [] };
  const byId = new Map(updates.map(update => [update.questionId, update.clip]));
  const patch = (question: Question) => (byId.has(question.id) ? { ...question, clip: byId.get(question.id) } : question);
  const next: GameState = {
    ...state,
    questions: state.questions.map(patch),
    pack: state.pack ? { ...state.pack, questions: state.pack.questions.map(patch) } : state.pack,
  };
  if (next.phase === 'PREPARING') return maybeStart(next, now, []);
  return { state: next, effects: [] };
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
function continueAfterSpeech(state: GameState, continuation: Continuation, now: number): ReduceResult {
  switch (continuation) {
    case 'advance':
      if (state.phase === 'INTRO') return presentQuestion(state, now);
      if (state.phase === 'REVEAL') return advance(state, now);
      return { state, effects: [] };
    case 'start-clue':
      if (state.phase !== 'QUESTION_INTRO') return { state, effects: [] };
      return startClue(state, now);
    case 'begin-answering':
      if (state.phase !== 'CLUE' && state.phase !== 'QUESTION_INTRO') return { state, effects: [] };
      return beginAnswering(state, now);
    case 'resume-clock':
      if (state.phase !== 'ANSWERING') return { state, effects: [] };
      return { state: { ...state, clock: resumeClock(state.clock, now) }, effects: [] };
    case 'begin-confirm-clock':
      if (state.phase !== 'CONFIRMING') return { state, effects: [] };
      return {
        state: {
          ...state,
          clock: state.clock?.kind === 'confirm' && state.clock.startedAt !== null
            ? state.clock
            : { kind: 'confirm', totalMs: state.config.confirmSeconds * 1000, remainingMs: state.config.confirmSeconds * 1000, startedAt: now, warned: true },
        },
        effects: [],
      };
    default:
      return { state, effects: [] };
  }
}

/** Ensures the current slot holds a playable question, swapping in a cached one if its clip failed. */
function ensurePlayable(state: GameState): GameState | null {
  const question = currentQuestion(state);
  if (!question) return state;
  if (isPlayable(question)) return state;
  const scheduled = new Set(state.questions.map(entry => entry.id));
  const used = new Set(state.usedQuestionIds);
  const pool = (state.pack?.questions ?? []).filter(entry => !scheduled.has(entry.id) && !used.has(entry.id) && isPlayable(entry));
  const replacement = pool[0];
  if (!replacement) return null;
  return { ...state, questions: state.questions.map((entry, index) => (index === state.questionIndex ? replacement : entry)) };
}

function presentQuestion(state: GameState, now: number): ReduceResult {
  const players = Math.max(1, state.players.length);
  // Plan the next round lazily, from whatever clips are cached by now.
  if (state.questionIndex >= state.questions.length) {
    if (state.roundsPlanned >= state.config.rounds) return finishGame(state);
    const plan = planRound(state, false);
    if (!plan) {
      // Pool ran dry (clips still caching, or more pool requested): pause on the caching screen.
      const pending = state.pack?.questions.some(question => question.clip?.status === 'pending');
      if (pending || !state.moreRequested) {
        const waiting = transition(state, 'PREPARING', { resumeAfterPrep: true, prepStartedAt: now, clock: null, pendingAnswer: null });
        const effects: Effect[] = [speak(waiting, lines.cachingMore())];
        if (!pending && !state.moreRequested) {
          effects.push(loadPackEffect(waiting));
          return { state: { ...waiting, moreRequested: true }, effects };
        }
        return { state: waiting, effects };
      }
      const partial = planRound(state, true);
      if (!partial) return finishGame(state, lines.noMoreClips());
      state = { ...state, questions: [...state.questions, ...partial.questions], roundsPlanned: state.roundsPlanned + 1 };
    } else {
      state = { ...state, questions: [...state.questions, ...plan.questions], roundsPlanned: state.roundsPlanned + 1 };
    }
  }
  const playable = ensurePlayable(state);
  if (!playable) {
    // Nothing cached to replace a broken clip: skip this slot.
    const skipped = { ...state, questions: state.questions.filter((_, index) => index !== state.questionIndex) };
    return presentQuestion(skipped, now);
  }
  state = playable;
  const question = currentQuestion(state)!;
  const player = activePlayer(state);
  if (!player) return finishGame(state);
  const next = transition(state, 'QUESTION_INTRO', {
    pendingAnswer: null,
    lastResult: null,
    clock: null,
    turnRemainingMs: null,
    replaysUsed: 0,
    hintsUsed: 0,
    lastUnhandled: null,
    usedQuestionIds: state.usedQuestionIds.includes(question.id) ? state.usedQuestionIds : [...state.usedQuestionIds, question.id],
  });
  const roundNumber = Math.floor(state.questionIndex / players) + 1;
  const isRoundStart = state.questionIndex % players === 0 && state.questionIndex > 0;
  const text = lines.questionIntro(player.name, question, roundNumber, isRoundStart);
  return {
    state: next,
    effects: [
      { type: 'sfx', name: isRoundStart ? 'transition' : 'click' },
      speak(next, text, 'start-clue'),
    ],
  };
}

function startClue(state: GameState, now: number): ReduceResult {
  const question = currentQuestion(state)!;
  void now;
  const next = transition(state, 'CLUE');
  return { state: next, effects: [{ type: 'sfx', name: 'clip-whoosh' }, { type: 'play-clip', question, seq: next.seq, seconds: next.config.clipSeconds }] };
}

/** The cached clip could not be played after all: swap the question or skip it. Never read a stand-in. */
function clueFailed(state: GameState, now: number): ReduceResult {
  const question = currentQuestion(state)!;
  const failed: GameState = {
    ...state,
    questions: state.questions.map(entry => (entry.id === question.id ? { ...entry, clip: { ...(entry.clip ?? { id: entry.id }), status: 'failed' } } : entry)),
    pack: state.pack ? { ...state.pack, questions: state.pack.questions.map(entry => (entry.id === question.id ? { ...entry, clip: { ...(entry.clip ?? { id: entry.id }), status: 'failed' } } : entry)) } : state.pack,
  };
  const replaced = ensurePlayable(failed);
  if (replaced) {
    const presented = presentQuestion(replaced, now);
    return { state: presented.state, effects: [{ type: 'stop-audio' }, speak(presented.state, lines.clipSwapped(), 'none', { interrupt: true }), ...presented.effects] };
  }
  const skipped = { ...failed, questions: failed.questions.filter((_, index) => index !== failed.questionIndex) };
  const presented = presentQuestion(skipped, now);
  return { state: presented.state, effects: [{ type: 'stop-audio' }, ...presented.effects] };
}

function beginAnswering(state: GameState, now: number): ReduceResult {
  const totalMs = state.config.turnSeconds * 1000;
  const remainingMs = state.turnRemainingMs !== null ? Math.max(5000, state.turnRemainingMs) : totalMs;
  const next = transition(state, 'ANSWERING', {
    clock: { kind: 'turn', totalMs, remainingMs, startedAt: now, warned: remainingMs <= WARNING_SECONDS * 1000 },
    turnRemainingMs: null,
    pendingAnswer: null,
  });
  return { state: next, effects: [{ type: 'sfx', name: 'buzz-in' }] };
}

/** Remaining turn time to carry forward when the turn clock is parked. */
function parkTurnClock(state: GameState, now: number): number | null {
  if (state.clock?.kind === 'turn') return clockRemainingMs(state.clock, now);
  return state.turnRemainingMs;
}

function heardAnswer(state: GameState, transcript: string, now: number): ReduceResult {
  const question = currentQuestion(state);
  if (!question) return { state, effects: [] };
  const match = findAnswerMatch(transcript, question.options, acceptedAnswersByOption(question));
  if (match) return askForConfirmation(state, { transcript, optionIndex: match.optionIndex }, now);
  // No textual match: park the clock and let the AI judge semantics.
  const next = transition(state, 'JUDGING', { clock: null, turnRemainingMs: parkTurnClock(state, now), pendingAnswer: { transcript, optionIndex: null } });
  return { state: next, effects: [{ type: 'judge', question, transcript, seq: next.seq }] };
}

function askForConfirmation(state: GameState, pending: PendingAnswer, now: number): ReduceResult {
  const question = currentQuestion(state)!;
  const player = activePlayer(state)!;
  const heard = pending.optionIndex !== null ? question.options[pending.optionIndex] : pending.transcript;
  const next = transition(state, 'CONFIRMING', {
    pendingAnswer: pending,
    turnRemainingMs: parkTurnClock(state, now),
    clock: { kind: 'confirm', totalMs: state.config.confirmSeconds * 1000, remainingMs: state.config.confirmSeconds * 1000, startedAt: null, warned: true },
  });
  return { state: next, effects: [{ type: 'sfx', name: 'lock-in' }, speak(next, lines.confirmPrompt(player.name, heard), 'begin-confirm-clock', { interrupt: true })] };
}

function confirmAnswer(state: GameState, now: number): ReduceResult {
  const question = currentQuestion(state)!;
  const pending = state.pendingAnswer;
  if (!pending) return beginAnswering(state, now);
  const correct = pending.optionIndex === question.correctIndex;
  return resolveTurn(state, correct ? 'correct' : 'wrong', pending.optionIndex, pending.transcript, now, correct);
}

function rejectAnswer(state: GameState, transcript: string, now: number): ReduceResult {
  const question = currentQuestion(state)!;
  const remaining = Math.max(5000, state.turnRemainingMs ?? 5000);
  // "No, it's Top Gun" carries the replacement answer in the same breath.
  let replacement = transcript.trim();
  for (let pass = 0; pass < 4; pass++) {
    replacement = replacement.replace(/^\s*(?:no|nope|nah|wait|actually|hold on|negative|change (?:it|that|my answer)|different answer|take it back|scratch that)[,.!\s]*(?:it'?s|its|i meant|i mean|make it|change it to|i said|i'?ll say|let'?s say)?[,\s]*/i, '').trim();
  }
  const hasReplacement = replacement.length >= 2 && !isFillerOnly(replacement) && replacement.toLowerCase() !== transcript.trim().toLowerCase();
  if (hasReplacement) {
    const match = findAnswerMatch(replacement, question.options, acceptedAnswersByOption(question));
    const base: GameState = { ...state, clock: null, turnRemainingMs: remaining };
    if (match) return askForConfirmation(base, { transcript: replacement, optionIndex: match.optionIndex }, now);
    const judging = transition(base, 'JUDGING', { pendingAnswer: { transcript: replacement, optionIndex: null } });
    return { state: judging, effects: [{ type: 'judge', question, transcript: replacement, seq: judging.seq }] };
  }
  const next = transition(state, 'ANSWERING', {
    pendingAnswer: null,
    turnRemainingMs: null,
    clock: { kind: 'turn', totalMs: state.config.turnSeconds * 1000, remainingMs: remaining, startedAt: null, warned: true },
  });
  return { state: next, effects: [speak(next, lines.changeAnswer(activePlayer(state)?.name ?? ''), 'resume-clock')] };
}

function clockExpired(state: GameState, now: number): ReduceResult {
  if (state.phase === 'ANSWERING') return resolveTurn(state, 'timeout', null, '', now);
  if (state.phase === 'CONFIRMING') return confirmAnswer(state, now);
  return { state, effects: [] };
}

function resolveTurn(state: GameState, outcome: Outcome, optionIndex: number | null, transcript: string, now: number, correct = false): ReduceResult {
  void now;
  const question = currentQuestion(state)!;
  const player = activePlayer(state)!;
  const finalOutcome: Outcome = outcome === 'correct' && !correct ? 'wrong' : outcome;
  const { delta, bonus } = scoreDelta(question, finalOutcome, player.streak);
  const players = state.players.map((entry, index) => index === state.playerIndex
    ? {
        ...entry,
        score: entry.score + delta,
        correctCount: finalOutcome === 'correct' ? entry.correctCount + 1 : entry.correctCount,
        streak: finalOutcome === 'correct' ? entry.streak + 1 : 0,
      }
    : entry);
  const result: TurnResult = { playerId: player.id, playerName: player.name, questionId: question.id, outcome: finalOutcome, optionIndex, transcript, delta, bonus };
  const next = transition(state, 'REVEAL', { players, lastResult: result, results: [...state.results, result], pendingAnswer: null, clock: null, turnRemainingMs: null });
  const isLast = state.questionIndex + 1 >= state.questions.length && state.roundsPlanned >= state.config.rounds;
  const effects: Effect[] = [
    { type: 'stop-audio' },
    { type: 'sfx', name: finalOutcome === 'correct' ? 'correct' : finalOutcome === 'wrong' ? 'wrong' : finalOutcome === 'timeout' ? 'timeout' : 'transition' },
  ];
  if (finalOutcome === 'correct' && bonus > 0) effects.push({ type: 'sfx', name: 'streak' });
  // Scripted (not improvised) so every reveal is short and starts instantly.
  effects.push(speak(next, lines.reveal(question, result, isLast), 'advance', { minDurationMs: REVEAL_MIN_MS, interrupt: true }));
  return { state: next, effects };
}

function replay(state: GameState, now: number): ReduceResult {
  const question = currentQuestion(state);
  if (!question || (state.phase !== 'ANSWERING' && state.phase !== 'CONFIRMING')) return { state, effects: [] };
  if (state.replaysUsed >= MAX_REPLAYS) return { state, effects: [speak(state, lines.noMoreReplays(), continuationFor(state))] };
  const turnRemainingMs = parkTurnClock(state, now);
  const next = transition(state, 'CLUE', { replaysUsed: state.replaysUsed + 1, clock: null, turnRemainingMs, pendingAnswer: null });
  return { state: next, effects: [{ type: 'stop-audio' }, { type: 'sfx', name: 'clip-whoosh' }, { type: 'play-clip', question, seq: next.seq, seconds: next.config.clipSeconds }] };
}

/** Reads the question's clue once per turn; the clock pauses while the host talks. */
function hint(state: GameState, now: number): ReduceResult {
  const question = currentQuestion(state);
  if (!question || state.phase !== 'ANSWERING') return { state, effects: [] };
  if (state.hintsUsed >= MAX_HINTS) return { state, effects: [speak(state, lines.noMoreHints())] };
  const next: GameState = {
    ...state,
    hintsUsed: state.hintsUsed + 1,
    clock: state.clock ? { ...state.clock, remainingMs: clockRemainingMs(state.clock, now) ?? state.clock.remainingMs, startedAt: null } : state.clock,
  };
  return { state: next, effects: [speak(next, lines.hint(question), 'resume-clock')] };
}

function advance(state: GameState, now: number): ReduceResult {
  const next: GameState = {
    ...state,
    questionIndex: state.questionIndex + 1,
    playerIndex: (state.playerIndex + 1) % Math.max(1, state.players.length),
  };
  return presentQuestion(next, now);
}

function finishGame(state: GameState, preface?: string): ReduceResult {
  const next = transition(state, 'GAME_OVER', { clock: null, pendingAnswer: null, gamesPlayed: state.gamesPlayed + 1 });
  const sorted = sortByScore(next.players);
  return {
    state: next,
    effects: [
      { type: 'stop-audio' },
      { type: 'sfx', name: 'fanfare' },
      { type: 'sfx', name: 'applause' },
      { type: 'celebrate' },
      speak(next, [preface, lines.gameOver(sorted, next.config.theme)].filter(Boolean).join(' '), 'none', { improv: lines.gameOverImprov(sorted, next.config.theme) }),
    ],
  };
}

function playAgain(state: GameState, now: number): ReduceResult {
  if (!state.pack) {
    const next = transition(createInitialState({ voiceReady: state.voiceReady, gamesPlayed: state.gamesPlayed, seq: state.seq }), 'THEME');
    return { state: next, effects: [speak(next, lines.askTheme())] };
  }
  const reset: GameState = {
    ...state,
    phase: 'PREPARING',
    seq: state.seq + 1,
    questions: [],
    roundsPlanned: 0,
    results: [],
    lastResult: null,
    questionIndex: 0,
    playerIndex: 0,
    prepStartedAt: now,
    resumeAfterPrep: false,
  };
  // Fresh clips only: top up the pool before the rematch if it is running low.
  const topUp = topUpEffects(reset);
  const primed = topUp.length ? { ...reset, moreRequested: true } : reset;
  const started = maybeStart(primed, now, [lines.playAgainIntro()]);
  return { state: started.state, effects: [{ type: 'music', enabled: reset.config.musicEnabled }, ...topUp, ...started.effects] };
}

// ---------------------------------------------------------------------------
// Derived helpers for the UI
// ---------------------------------------------------------------------------
export interface PrepProgress {
  ready: number;
  pending: number;
  failed: number;
  local: number;
  online: number;
}

export function prepProgress(pack: ThemePack | null): PrepProgress {
  const progress: PrepProgress = { ready: 0, pending: 0, failed: 0, local: 0, online: 0 };
  for (const question of pack?.questions ?? []) {
    const status = question.clip?.status ?? 'failed';
    if (status === 'ready') {
      progress.ready += 1;
      if (question.clip?.provider === 'local') progress.local += 1;
      else progress.online += 1;
    } else if (status === 'pending') progress.pending += 1;
    else progress.failed += 1;
  }
  return progress;
}

export function describeVoicePrompt(state: GameState): string {
  const player = activePlayer(state);
  switch (state.phase) {
    case 'THEME': return 'Say a theme: a decade, a genre, a franchise, or "surprise me".';
    case 'PLAYER_COUNT': return 'Say how many players: one, two, three, or four.';
    case 'PLAYER_NAMES': return `Player ${state.setupPlayerIndex + 1}, say your name.`;
    case 'PREPARING': return 'Caching song clips...';
    case 'INTRO': return 'The host is introducing the game.';
    case 'QUESTION_INTRO': return 'Listen...';
    case 'CLUE': return 'Listen closely...';
    case 'ANSWERING': return `${player?.name || 'Player'}: say your answer, "hint", "play it again", or "pass".`;
    case 'JUDGING': return 'Checking that answer...';
    case 'CONFIRMING': return 'Say yes to lock it in, or no to change it.';
    case 'REVEAL': return 'Say "next" to skip ahead, or "scoreboard".';
    case 'GAME_OVER': return 'Say "play again" or "new theme".';
    default: return '';
  }
}

/** Human label for where a clip came from, e.g. "Online · Deezer" or "Local file". */
export function clipSourceLabel(clip: { provider?: string; sourceUrl?: string } | undefined): { kind: 'online' | 'local' | 'unknown'; label: string } {
  if (!clip?.provider) return { kind: 'unknown', label: '' };
  if (clip.provider === 'local') return { kind: 'local', label: 'Local file' };
  if (clip.provider === 'mock') return { kind: 'online', label: 'Online · mock' };
  const url = clip.sourceUrl ?? '';
  const catalog = clip.provider === 'preview'
    ? /dzcdn|deezer/i.test(url) ? 'Deezer' : /apple|itunes|mzstatic/i.test(url) ? 'iTunes' : 'catalog preview'
    : clip.provider === 'itunes' ? 'iTunes' : clip.provider === 'deezer' ? 'Deezer' : clip.provider === 'ytdlp' ? 'YouTube' : clip.provider;
  return { kind: 'online', label: `Online · ${catalog}` };
}
