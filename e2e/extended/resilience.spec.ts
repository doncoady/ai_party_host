import { expect, test } from '../fixtures.ts';

test.describe('resilience', () => {

  test('stale speech completions never advance the game twice', async ({ game }) => {
    await game.setup({ theme: 'disney movies', players: ['Alice', 'Bob'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('pass');
    const reveal = await game.waitForPhase('REVEAL');
    // Replay an old continuation with a stale seq: it must be ignored.
    await game.page.evaluate(seq => window.__partyHost!.dispatch({ type: 'SPEECH_DONE', seq: seq - 1, continuation: 'advance' }), reveal.seq);
    expect((await game.state()).questionIndex).toBe(0);
    await game.say('next');
    const next = await game.waitForPhase('QUESTION_INTRO');
    expect(next.questionIndex).toBe(1);
  });

  test('the page stays usable at phone width', async ({ game, page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await game.say('the 80s, one player');
    await game.waitForPhase('PLAYER_NAMES');
    await expect(page.getByTestId('typed-input')).toBeVisible();
    await expect(page.getByTestId('name-input')).toBeVisible();
    await page.getByTestId('quick-start').click();
    await game.waitForPhase('INTRO', 40_000);
    await game.waitForAnswering();
    await expect(page.getByTestId('pass')).toBeVisible();
  });
});
