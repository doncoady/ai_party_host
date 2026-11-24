import { expect, test } from '../fixtures.ts';

/**
 * Core end-to-end coverage: one voice-driven setup, one GUI setup, one complete
 * game with every answer path, and the live-socket fallback. The extended
 * project covers the long tail (presets, hints, streaks, noise, layouts…).
 */
const SONGS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

test('voice setup: theme, players and names in a few breaths', async ({ game, page }) => {
  await expect(page.getByTestId('setup-theme')).toBeVisible();
  await game.say('country, two players, one round, six seconds per turn');
  const configured = await game.waitForPhase('PLAYER_NAMES');
  expect(configured.config.theme).toBe('Country');
  expect(configured.config.turnSeconds).toBe(6);
  await expect(page.getByTestId('theme-banner-name')).toHaveText('COUNTRY');
  await expect(page.getByTestId('prep-meter')).toBeVisible();
  await game.say('my name is Alice');
  await game.say('Bob');
  const state = await game.waitForPhase('INTRO', 40_000);
  expect(state.players.map(player => player.name)).toEqual(['Alice', 'Bob']);
  expect(state.questions).toHaveLength(2);
  expect(state.questions.every(question => question.clip?.status === 'ready')).toBe(true);
});

test('GUI setup: settings drawer configures and starts; typed commands work', async ({ game, page }) => {
  await page.getByTestId('settings-open').click();
  await page.getByTestId('settings-theme').fill('Disco');
  await page.getByTestId('settings-players-1').click();
  await page.getByTestId('settings-name-1').fill('Solo');
  await page.getByTestId('settings-rounds').fill('1');
  await page.getByTestId('settings-music').uncheck();
  await page.getByTestId('settings-clip-position').selectOption('hook');
  await page.getByTestId('settings-start').click();
  const state = await game.waitForPhase('INTRO', 40_000);
  expect(state.config.theme).toBe('Disco');
  expect(state.config.musicEnabled).toBe(false);
  expect(state.config.clipPosition).toBe('hook');
  await expect(page.getByTestId('music-toggle')).toHaveAttribute('aria-pressed', 'false');
  await game.waitForAnswering();
  await game.type('pass');
  await game.waitForPhase('REVEAL');
  await expect(page.getByTestId('heard-transcript')).toHaveText('"pass"');
});

test('a full game: clip, answer, confirmation, change of mind, judge, pass, timeout, scoring, game over', async ({ game, page }) => {
  await game.setup({ theme: 'disney movies', players: ['Alice', 'Bob'], extra: 'two rounds, six seconds per turn' });

  // Q1 Alice: matched answer → confirm → correct.
  let state = await game.waitForAnswering();
  expect((await game.history())).toContain('CLUE');
  await expect(page.getByTestId('clip-source')).toHaveAttribute('data-source-kind', 'online');
  await game.say(`I think it is ${SONGS[0]}`);
  state = await game.waitForPhase('CONFIRMING');
  expect(state.pendingAnswer?.optionIndex).toBe(0);
  await game.expectHostSaid(/^Final answer, Alice\?$/);
  await game.say('yes');
  state = await game.waitForPhase('REVEAL');
  expect(state.lastResult?.outcome).toBe('correct');
  expect(state.players[0].score).toBe(1000);
  await expect(page.getByTestId('score-value-p1')).toHaveText('$1,000');

  // Q2 Bob: "no" changes the answer; an unknown answer goes through the judge; wrong costs points.
  await game.waitForAnswering();
  await game.say('bravo');
  await game.waitForPhase('CONFIRMING');
  await game.say('no');
  state = await game.waitForPhase('ANSWERING');
  expect(state.pendingAnswer).toBeNull();
  await game.say('something nobody can match');
  state = await game.waitForPhase('CONFIRMING');
  expect((await game.history())).toContain('JUDGING');
  await page.getByTestId('confirm-yes').click();
  state = await game.waitForPhase('REVEAL');
  expect(state.lastResult?.outcome).toBe('wrong');
  expect(state.players[1].score).toBe(-1250);
  await expect(page.getByTestId('correct-answer')).toHaveText(SONGS[1]);

  // Round 2. Q3 Alice: pass. Q4 Bob: the clock runs out.
  state = await game.waitForAnswering();
  expect(state.roundsPlanned).toBe(2);
  await expect(page.getByTestId('theme-banner-round')).toContainText('ROUND 2/2');
  await game.say('pass');
  state = await game.waitForPhase('REVEAL');
  expect(state.lastResult?.outcome).toBe('pass');
  await game.waitForAnswering();
  state = await game.waitForPhase('REVEAL', 20_000);
  expect(state.lastResult?.outcome).toBe('timeout');

  state = await game.waitForPhase('GAME_OVER', 40_000);
  expect(state.results).toHaveLength(4);
  await expect(page.getByTestId('final-p1')).toHaveAttribute('data-rank', '1');
  expect(state.usedQuestionIds).toHaveLength(4);
});

test('the game keeps flowing on typed input when the live socket drops, then reconnects', async ({ game, page }) => {
  await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
  await game.waitForAnswering();
  await game.say('alpha');
  await game.waitForPhase('CONFIRMING');
  await page.evaluate(() => window.__partyHost!.dropLiveSocket());
  await game.type('yes');
  const state = await game.waitForPhase('REVEAL');
  expect(state.lastResult?.outcome).toBe('correct');
  await page.waitForFunction(() => window.__partyHost!.liveState().connection === 'ready', null, { timeout: 15_000 });
  await game.waitForPhase('GAME_OVER', 40_000);
});
