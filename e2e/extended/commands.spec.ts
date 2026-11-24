import { expect, test } from '../fixtures.ts';

test.describe('in-game voice commands', () => {
  test('scoreboard and help are answered without derailing the flow', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Alice', 'Bob'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('alpha final answer');
    await game.waitForPhase('REVEAL');
    await game.say("what's the score");
    await game.expectHostSaid(/Alice leads with \$1,000/);
    // The reveal continuation survives the interruption.
    await game.waitForAnswering();
    await game.say('help');
    await game.expectHostSaid(/Say the song or the artist/);
    expect((await game.state()).phase).toBe('ANSWERING');
    await expect(page.getByTestId('host-subtitle')).toBeVisible();
  });

  test('music and sound effects can be toggled by voice mid-game', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('turn off the music');
    await expect(page.getByTestId('music-toggle')).toHaveAttribute('aria-pressed', 'false');
    await game.say('turn the music back on');
    await expect(page.getByTestId('music-toggle')).toHaveAttribute('aria-pressed', 'true');
    await game.say('turn off sound effects');
    await expect(page.getByTestId('sfx-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect((await game.state()).phase).toBe('ANSWERING');
  });

  test('changing the theme mid-game keeps the roster and rebuilds the pack', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Alice', 'Bob'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('change the theme to the nineties');
    const state = await game.waitForPhase('INTRO', 40_000);
    expect(state.config.theme).toBe('The 90s');
    expect(state.pack?.id).toBe('builtin-90s');
    expect(state.players.map(player => player.name)).toEqual(['Alice', 'Bob']);
    expect(state.players.every(player => player.score === 0)).toBe(true);
    await expect(page.getByTestId('header-theme')).toHaveText('The 90s');
  });

  test('the player count cannot change mid-game', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('three players');
    await game.expectHostSaid(/can't change the player count/);
    expect((await game.state()).players).toHaveLength(1);
    void page;
  });

  test('next skips the reveal narration', async ({ game }) => {
    await game.setup({ theme: 'disney movies', players: ['Alice', 'Bob'], extra: 'one round' });
    await game.waitForAnswering();
    await game.say('pass');
    await game.waitForPhase('REVEAL');
    await game.say('next');
    const state = await game.waitForPhase('QUESTION_INTRO');
    expect(state.questionIndex).toBe(1);
  });
});
