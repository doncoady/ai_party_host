import { expect, test } from '../fixtures.ts';

/** The mock pack is deterministic: songs answer the NATO alphabet in order. */
const SONGS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

test.describe('gameplay loop', () => {


  test('pass, replay limits and the clock running out', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'two rounds, six seconds per turn' });
    let state = await game.waitForAnswering();
    expect(state.config.turnSeconds).toBe(6);

    // One replay is allowed and pauses/carries the clock.
    await page.getByTestId('replay').click();
    await game.waitForPhase('CLUE');
    state = await game.waitForPhase('ANSWERING');
    expect(state.replaysUsed).toBe(1);
    await expect(page.getByTestId('replay')).toHaveCount(0);
    await game.say('play it again');
    await game.expectHostSaid(/No more replays/);

    await game.say('pass');
    state = await game.waitForPhase('REVEAL');
    expect(state.lastResult?.outcome).toBe('pass');
    expect(state.players[0].score).toBe(0);
    await expect(page.getByTestId('reveal-headline')).toContainText('PASSED');

    // Let the clock expire on the second question.
    state = await game.waitForAnswering();
    state = await game.waitForPhase('REVEAL', 20_000);
    expect(state.lastResult?.outcome).toBe('timeout');
    await expect(page.getByTestId('reveal-headline')).toContainText('RAN OUT OF TIME');
    await game.waitForPhase('GAME_OVER', 40_000);
  });

  test('streaks carry across rounds', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'two rounds' });
    await game.waitForAnswering();
    await game.say(`${SONGS[0]} final answer`);
    let state = await game.waitForPhase('REVEAL');
    expect(state.lastResult?.bonus).toBe(0);
    state = await game.waitForAnswering();
    expect(state.roundsPlanned).toBe(2);
    await expect(page.getByTestId('theme-banner-round')).toContainText('ROUND 2/2');
    await game.say(`${SONGS[1]} final answer`);
    state = await game.waitForPhase('REVEAL');
    expect(state.lastResult?.outcome).toBe('correct');
    expect(state.lastResult?.bonus).toBeGreaterThan(0);
    expect(state.players[0].streak).toBe(2);
  });

  test('hint reads the clue once and pauses the clock', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    await game.waitForAnswering();
    await page.getByTestId('hint').click();
    await game.expectHostSaid(/Hint: Clue 1/);
    await expect(page.getByTestId('hint')).toHaveCount(0);
    await expect.poll(async () => (await game.state()).clock?.startedAt !== null).toBe(true);
    await game.say('hint');
    await game.expectHostSaid(/No more hints/);
    expect((await game.state()).phase).toBe('ANSWERING');
  });

  test('play again rotates to fresh questions; new theme restarts setup', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    const first = await game.waitForAnswering();
    await game.say('pass');
    await game.waitForPhase('GAME_OVER', 40_000);

    await page.getByTestId('play-again').click();
    const rematch = await game.waitForPhase('INTRO', 40_000);
    expect(rematch.questions[0].id).not.toBe(first.questions[0].id);
    expect(rematch.usedQuestionIds).toContain(first.questions[0].id);
    expect(rematch.players[0].score).toBe(0);

    await game.waitForAnswering();
    await game.say('pass');
    await game.waitForPhase('GAME_OVER', 40_000);
    await game.say('new theme');
    const fresh = await game.waitForPhase('THEME');
    expect(fresh.players).toHaveLength(0);
    expect(fresh.config.theme).toBe('');
    await expect(page.getByTestId('setup-theme')).toBeVisible();
  });
});
