import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, planRound, prepProgress, reduce, PREP_MAX_WAIT_MS, type Effect, type GameEvent, type GameState } from './engine.ts';
import { EIGHTIES_PACK } from '../../shared/packs/eighties.ts';
import type { ThemePack } from './types.ts';

/** Marks every media question's clip as cached, optionally only some of them. */
function readyPack(pack: ThemePack = EIGHTIES_PACK, filter: (questionId: string) => 'ready' | 'pending' | 'failed' = () => 'ready'): ThemePack {
  return {
    ...pack,
    questions: pack.questions.map(question => ({ ...question, clip: { id: `clip-${question.id}`, status: filter(question.id), url: `/api/clips/${question.id}` } })),
  };
}
const READY_PACK = readyPack();

/** Tiny harness: dispatch events, collect effects, and auto-complete speech when asked. */
function harness(initial = createInitialState()) {
  let state = initial;
  const effects: Effect[] = [];
  const now = { value: 1_000_000 };
  const dispatch = (event: GameEvent) => {
    const result = reduce(state, { now: now.value, ...event } as GameEvent);
    state = result.state;
    effects.push(...result.effects);
    return result;
  };
  const say = (text: string) => dispatch({ type: 'TRANSCRIPT', text });
  /** Simulate the host finishing every pending speech effect (in order). */
  const finishSpeech = () => {
    const pending = effects.filter((effect): effect is Extract<Effect, { type: 'speak' }> => effect.type === 'speak');
    effects.length = 0;
    for (const speech of pending) dispatch({ type: 'SPEECH_DONE', seq: speech.seq, continuation: speech.continuation });
  };
  const finishMedia = () => {
    const pending = effects.filter((effect): effect is Extract<Effect, { type: 'play-clip' }> => effect.type === 'play-clip');
    effects.length = 0;
    for (const media of pending) dispatch({ type: 'MEDIA_DONE', seq: media.seq });
  };
  const lastSpeech = () => [...effects].reverse().find(effect => effect.type === 'speak') as Extract<Effect, { type: 'speak' }> | undefined;
  const sfx = () => effects.filter(effect => effect.type === 'sfx').map(effect => (effect as Extract<Effect, { type: 'sfx' }>).name);
  return { get state() { return state; }, effects, now, dispatch, say, finishSpeech, finishMedia, lastSpeech, sfx };
}

function setupTwoPlayers(game: ReturnType<typeof harness>) {
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('the eighties');
  assert.equal(game.state.phase, 'PLAYER_COUNT');
  assert.ok(game.effects.some(effect => effect.type === 'load-pack'));
  game.say('two players');
  assert.equal(game.state.phase, 'PLAYER_NAMES');
  game.say('my name is Alice');
  game.say('Bob');
  assert.deepEqual(game.state.players.map(player => player.name), ['Alice', 'Bob']);
}

test('boot asks for a theme and kicks off music', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  assert.equal(game.state.phase, 'THEME');
  assert.ok(game.effects.some(effect => effect.type === 'music' && effect.enabled));
  assert.match(game.lastSpeech()!.text, /theme/i);
});

test('setup flows from theme to names and waits for the pack', () => {
  const game = harness();
  setupTwoPlayers(game);
  assert.equal(game.state.phase, 'PREPARING');
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  assert.equal(game.state.phase, 'INTRO');
  assert.equal(game.state.questions.length, 2, 'round one is scheduled; round two is planned when reached');
  assert.equal(game.state.roundsPlanned, 1);
  assert.ok(game.sfx().includes('game-start'));
});

test('a pack that arrives early starts the game as soon as names are in', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('eighties');
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.say('one player');
  game.say('Zed');
  assert.equal(game.state.phase, 'INTRO');
});

test('one utterance can configure several things at once', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('three players, the 90s, hard mode, ten seconds per turn');
  assert.equal(game.state.config.theme, 'The 90s');
  assert.equal(game.state.players.length, 3);
  assert.equal(game.state.config.difficulty, 'hard');
  assert.equal(game.state.config.turnSeconds, 10);
  assert.equal(game.state.phase, 'PLAYER_NAMES');
});

test('quick start fills in defaults', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('quick start');
  assert.equal(game.state.config.theme, 'The 80s');
  assert.equal(game.state.players.length, 1);
  assert.equal(game.state.players[0].name, 'Player 1');
  assert.equal(game.state.phase, 'PREPARING');
  assert.ok(game.effects.some(effect => effect.type === 'load-pack'));
});

test('full turn: clue, answer, confirmation, reveal and scoring', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech(); // intro → first question
  assert.equal(game.state.phase, 'QUESTION_INTRO');
  assert.equal(game.state.questions[0].type, 'SONG_CLIP');
  assert.match(game.lastSpeech()!.text, /name that tune/i);
  game.finishSpeech(); // clue → play clip
  assert.equal(game.state.phase, 'CLUE');
  assert.ok(game.effects.some(effect => effect.type === 'play-clip'));
  game.finishMedia();
  assert.equal(game.state.phase, 'ANSWERING');
  assert.equal(game.state.clock?.kind, 'turn');

  game.say('I think it is take on me by a-ha');
  assert.equal(game.state.phase, 'CONFIRMING');
  assert.equal(game.state.pendingAnswer?.optionIndex, 0);
  assert.equal(game.state.clock?.startedAt, null, 'confirm clock waits for the host to finish');
  game.finishSpeech();
  assert.equal(game.state.clock?.startedAt, game.now.value);

  game.say('yes');
  assert.equal(game.state.phase, 'REVEAL');
  assert.equal(game.state.lastResult?.outcome, 'correct');
  assert.equal(game.state.players[0].score, 1000);
  assert.ok(game.sfx().includes('correct'));

  game.finishSpeech(); // reveal → next question for Bob
  assert.equal(game.state.phase, 'QUESTION_INTRO');
  assert.equal(game.state.playerIndex, 1);
  assert.equal(game.state.questionIndex, 1);
});

test('wrong answers deduct points and unknown answers go to the judge', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('duran duran');
  game.finishSpeech();
  game.say('yep');
  assert.equal(game.state.lastResult?.outcome, 'wrong');
  assert.equal(game.state.players[0].score, -1000);
  assert.ok(game.sfx().includes('wrong'));

  game.finishSpeech(); // Bob's question (round one: another song)
  game.finishSpeech();
  game.finishMedia();
  assert.equal(game.state.questions[1].id, '80s-song-never-gonna');
  game.say('the red haired guy, astley');
  assert.equal(game.state.phase, 'CONFIRMING', 'alias "astley" matched textually');
  game.say('no, george michael');
  assert.equal(game.state.phase, 'CONFIRMING');
  assert.equal(game.state.pendingAnswer?.optionIndex, 1);
  game.say('no');
  assert.equal(game.state.phase, 'ANSWERING');
  assert.ok((game.state.clock?.remainingMs ?? 0) >= 5000);
  game.say('some rambling nonsense');
  assert.equal(game.state.phase, 'JUDGING');
  const judge = game.effects.find(effect => effect.type === 'judge') as Extract<Effect, { type: 'judge' }>;
  assert.ok(judge);
  game.dispatch({ type: 'JUDGED', seq: judge.seq, optionIndex: null });
  assert.equal(game.state.phase, 'CONFIRMING');
  game.finishSpeech();
  game.say('yes');
  assert.equal(game.state.lastResult?.outcome, 'wrong');
});

test('timeouts, passes and streak bonuses', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.dispatch({ type: 'CLOCK_WARNING', seq: game.state.seq });
  assert.ok(game.sfx().includes('timer-warning'));
  game.now.value += 21_000;
  game.dispatch({ type: 'CLOCK_EXPIRED', seq: game.state.seq, now: game.now.value });
  assert.equal(game.state.lastResult?.outcome, 'timeout');
  assert.equal(game.state.players[0].score, 0);

  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  assert.equal(game.state.lastResult?.outcome, 'pass');

  // Round two; Alice's streak starts here.
  game.finishSpeech();
  assert.equal(game.state.roundsPlanned, 2);
  assert.match(game.lastSpeech()!.text, /Round 2\./);
  game.finishSpeech();
  game.finishMedia();
  const alice = game.state.players[0];
  assert.equal(game.state.questions[2].id, '80s-song-sweet-dreams');
  game.say('eurythmics final answer');
  assert.equal(game.state.phase, 'REVEAL');
  assert.equal(game.state.players[0].score, alice.score + 1500);
  assert.equal(game.state.players[0].streak, 1);
});

test('replay is limited and pauses the clock', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.now.value += 4000;
  game.say('play it again');
  assert.equal(game.state.phase, 'CLUE');
  assert.ok(game.effects.some(effect => effect.type === 'play-clip'));
  assert.ok(game.state.turnRemainingMs !== null && game.state.turnRemainingMs <= 16_000);
  game.finishMedia();
  assert.equal(game.state.phase, 'ANSWERING');
  assert.ok((game.state.clock?.remainingMs ?? 0) <= 16_000);
  game.say('one more time');
  assert.equal(game.state.phase, 'ANSWERING');
  assert.match(game.lastSpeech()!.text, /no more replays/i);
});

test('stale continuation events are ignored', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  const intro = game.lastSpeech()!;
  game.finishSpeech();
  const phase = game.state.phase;
  game.dispatch({ type: 'SPEECH_DONE', seq: intro.seq, continuation: intro.continuation });
  assert.equal(game.state.phase, phase);
});

test('scoreboard during reveal re-attaches the advance continuation', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('a-ha final answer');
  assert.equal(game.state.phase, 'REVEAL');
  game.effects.length = 0;
  game.say("what's the score");
  const speech = game.lastSpeech()!;
  assert.match(speech.text, /Alice leads/);
  assert.equal(speech.continuation, 'advance');
  game.finishSpeech();
  assert.equal(game.state.phase, 'QUESTION_INTRO');
});

test('game over, play again and new theme', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('eighties, one player, one round');
  game.say('Solo');
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  assert.equal(game.state.questions.length, 1);
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  game.finishSpeech();
  assert.equal(game.state.phase, 'GAME_OVER');
  assert.ok(game.sfx().includes('fanfare'));
  assert.ok(game.effects.some(effect => effect.type === 'celebrate'));

  game.say('play again');
  assert.equal(game.state.phase, 'INTRO');
  assert.notEqual(game.state.questions[0].id, EIGHTIES_PACK.questions[0].id, 'rematch prefers questions not played yet');

  game.say('new theme');
  assert.equal(game.state.phase, 'THEME');
  assert.equal(game.state.players.length, 0);
});

test('changing theme mid-game keeps the roster and rebuilds the pack', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.say('change the theme to the nineties');
  assert.equal(game.state.phase, 'PREPARING');
  assert.equal(game.state.config.theme, 'The 90s');
  assert.deepEqual(game.state.players.map(player => player.name), ['Alice', 'Bob']);
  assert.ok(game.effects.some(effect => effect.type === 'load-pack' && effect.themeQuery === 'The 90s'));
});

test('pack failure with a fallback keeps the game going', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('obscure theme nobody knows');
  game.say('one player');
  game.say('Kim');
  assert.equal(game.state.phase, 'PREPARING');
  game.dispatch({ type: 'PACK_FAILED', error: 'offline', fallback: READY_PACK });
  assert.equal(game.state.phase, 'INTRO');
  assert.equal(game.state.config.theme, 'the 80s');
});

test('GUI settings apply the same way as voice', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: false });
  game.dispatch({ type: 'APPLY_SETTINGS', settings: { theme: 'Disney Movies', playerCount: 2, rounds: 1, turnSeconds: 15 }, names: ['Ann', 'Ben'], start: true });
  assert.equal(game.state.phase, 'PREPARING');
  assert.deepEqual(game.state.players.map(player => player.name), ['Ann', 'Ben']);
  assert.equal(game.state.config.turnSeconds, 15);
});

test('rounds are planned from whichever clips are cached, in pack order, never repeating', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: readyPack(EIGHTIES_PACK, id => (id.includes('final-countdown') || id.includes('billie') ? 'ready' : 'pending')) });
  assert.equal(game.state.phase, 'INTRO');
  assert.deepEqual(game.state.questions.map(q => q.id), ['80s-song-final-countdown', '80s-song-billie-jean']);
  // The rest finish caching in the background → round two draws from them, not from round one.
  game.dispatch({ type: 'CLIP_UPDATED', updates: EIGHTIES_PACK.questions.map(q => ({ questionId: q.id, clip: { id: `clip-${q.id}`, status: 'ready' as const } })) });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  game.finishSpeech();
  assert.equal(game.state.roundsPlanned, 2);
  assert.deepEqual(game.state.questions.slice(2).map(q => q.id), ['80s-song-take-on-me', '80s-song-never-gonna']);
});

test('preparing waits for round-one clips, then starts as soon as they are cached', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: readyPack(EIGHTIES_PACK, () => 'pending') });
  assert.equal(game.state.phase, 'PREPARING');
  const progress = prepProgress(game.state.pack);
  assert.equal(progress.pending, 8);
  game.dispatch({ type: 'CLIP_UPDATED', updates: [{ questionId: '80s-song-take-on-me', clip: { id: 'x', status: 'ready' } }] });
  assert.equal(game.state.phase, 'PREPARING', 'one cached song is not enough for two players');
  game.dispatch({ type: 'CLIP_UPDATED', updates: [{ questionId: '80s-song-never-gonna', clip: { id: 'y', status: 'ready' } }] });
  assert.equal(game.state.phase, 'INTRO');
  assert.deepEqual(game.state.questions.map(q => q.id), ['80s-song-take-on-me', '80s-song-never-gonna']);
});

test('after the wait budget, preparing starts with whatever is cached rather than stalling', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: readyPack(EIGHTIES_PACK, id => (id === '80s-song-jump' ? 'ready' : 'pending')) });
  game.now.value += PREP_MAX_WAIT_MS + 1;
  game.dispatch({ type: 'PREP_TICK', now: game.now.value });
  assert.equal(game.state.phase, 'INTRO');
  assert.deepEqual(game.state.questions.map(q => q.id), ['80s-song-jump']);
});

test('a clip that fails at play time is swapped for a cached one, never narrated', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  assert.equal(game.state.phase, 'CLUE');
  const media = game.effects.find(effect => effect.type === 'play-clip') as Extract<Effect, { type: 'play-clip' }>;
  game.effects.length = 0;
  game.dispatch({ type: 'MEDIA_DONE', seq: media.seq, failed: true });
  assert.equal(game.state.phase, 'QUESTION_INTRO');
  assert.notEqual(game.state.questions[0].id, '80s-song-take-on-me');
  assert.ok(!game.effects.some(effect => effect.type === 'speak' && /question instead/i.test(effect.text)));
});

test('hint reads the clue once and pauses the clock', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('hint');
  assert.equal(game.state.clock?.startedAt, null);
  assert.match(game.lastSpeech()!.text, /Norwegian trio/);
  game.finishSpeech();
  assert.notEqual(game.state.clock?.startedAt, null);
  game.say('give me a hint');
  assert.match(game.lastSpeech()!.text, /No more hints/);
});

test('user-initiated lines interrupt, async continuations queue', () => {
  const game = harness();
  setupTwoPlayers(game);
  game.effects.length = 0;
  game.dispatch({ type: 'PACK_READY', pack: READY_PACK });
  const intro = game.lastSpeech()!;
  assert.equal(intro.interrupt, false, 'the intro waits for the "caching" line to finish');
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.effects.length = 0;
  game.say('a-ha');
  assert.equal(game.lastSpeech()!.interrupt, true);
});

test('planRound never reuses a played clip and accepts a short round only when allowed', () => {
  const base = createInitialState({ players: [{ id: 'p1', name: 'A', score: 0, color: '', borderHex: '', bgHex: '', avatar: '', correctCount: 0, streak: 0 }], pack: READY_PACK });
  const first = planRound(base)!;
  assert.equal(first.questions[0].id, EIGHTIES_PACK.questions[0].id);
  const usedAllButOne = planRound({ ...base, usedQuestionIds: EIGHTIES_PACK.questions.slice(0, 7).map(q => q.id) })!;
  assert.equal(usedAllButOne.questions[0].id, EIGHTIES_PACK.questions[7].id);
  const two = { ...base, players: [base.players[0], { ...base.players[0], id: 'p2' }], usedQuestionIds: EIGHTIES_PACK.questions.slice(0, 7).map(q => q.id) };
  assert.equal(planRound(two), null, 'one cached clip is not enough for two players');
  assert.equal(planRound(two, true)?.questions.length, 1);
  assert.equal(planRound({ ...base, pack: readyPack(EIGHTIES_PACK, () => 'failed') }, true), null);
});

test('describe state snapshot is serialisable', () => {
  const state: GameState = createInitialState();
  assert.doesNotThrow(() => JSON.stringify(state));
});

test('rematches never repeat a clip and ask the server for more pool when it runs low', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('eighties, one player, one round');
  game.say('Solo');
  // Only two songs cached: the first game uses one, the rematch must use the other and ask for more.
  game.dispatch({ type: 'PACK_READY', pack: readyPack(EIGHTIES_PACK, id => (id === '80s-song-take-on-me' || id === '80s-song-never-gonna' ? 'ready' : 'failed')) });
  const firstId = game.state.questions[0].id;
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  game.finishSpeech();
  assert.equal(game.state.phase, 'GAME_OVER');
  game.effects.length = 0;
  game.say('play again');
  assert.equal(game.state.phase, 'INTRO');
  assert.notEqual(game.state.questions[0].id, firstId);
  const more = game.effects.find(effect => effect.type === 'load-pack') as Extract<Effect, { type: 'load-pack' }>;
  assert.ok(more, 'pool is nearly empty so more questions are requested');
  assert.ok(more.exclude.includes(firstId));
});

test('when the pool is dry mid-game the show pauses for fresh clips instead of repeating', () => {
  const game = harness();
  game.dispatch({ type: 'BOOT', voiceReady: true });
  game.say('eighties, one player, two rounds');
  game.say('Solo');
  game.dispatch({ type: 'PACK_READY', pack: readyPack(EIGHTIES_PACK, id => (id === '80s-song-take-on-me' ? 'ready' : 'pending')) });
  game.finishSpeech();
  game.finishSpeech();
  game.finishMedia();
  game.say('pass');
  game.finishSpeech();
  assert.equal(game.state.phase, 'PREPARING');
  assert.equal(game.state.resumeAfterPrep, true);
  game.dispatch({ type: 'CLIP_UPDATED', updates: [{ questionId: '80s-song-never-gonna', clip: { id: 'y', status: 'ready' } }] });
  assert.equal(game.state.phase, 'QUESTION_INTRO');
  assert.equal(game.state.questions[1].id, '80s-song-never-gonna');
});
