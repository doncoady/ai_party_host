import { expect, test } from '../fixtures.ts';

test.describe('voice-driven setup', () => {
  test('boots straight into the theme prompt with the live host connected', async ({ game, page }) => {
    await expect(page.getByTestId('setup-theme')).toBeVisible();
    await expect(page.getByTestId('voice-status')).toContainText(/LIVE VOICE READY|MIC PAUSED/);
    await expect(page.getByTestId('header-theme')).toHaveText('PICK A THEME');
    const history = await game.history();
    expect(history[0]).toBe('THEME');
  });


  test('one breath can configure everything at once', async ({ game }) => {
    await game.say('two players, classic rock, hard mode, ten seconds per turn, one round');
    const state = await game.waitForPhase('PLAYER_NAMES');
    expect(state.config.theme).toBe('Classic Rock');
    expect(state.config.difficulty).toBe('hard');
    expect(state.config.turnSeconds).toBe(10);
    expect(state.config.rounds).toBe(1);
    expect(state.players).toHaveLength(2);
  });

  test('surprise me picks a theme and quick start fills in defaults', async ({ game, page }) => {
    await game.say('surprise me');
    const state = await game.waitForPhase('PLAYER_COUNT');
    expect(state.config.theme.length).toBeGreaterThan(2);
    await game.say('quick start');
    const started = await game.waitForPhase('INTRO', 40_000);
    expect(started.players.map(player => player.name)).toEqual(['Player 1']);
    expect(await game.history()).toContain('INTRO');
    void page;
  });

  test('the host nudges when it cannot make sense of a player count', async ({ game, page }) => {
    await game.say('hip hop');
    await game.waitForPhase('PLAYER_COUNT');
    await game.say('banana sandwich');
    await game.expectHostSaid(/One, two, three, or four players/);
    await game.say('seven players');
    await game.expectHostSaid(/four buzzers/);
    expect((await game.state()).phase).toBe('PLAYER_COUNT');
    await expect(page.getByTestId('host-subtitle')).toBeVisible();
  });

  test('caching starts the moment a theme is chosen and is visible during setup', async ({ game, page }) => {
    await game.say('video game music');
    await game.waitForPhase('PLAYER_COUNT');
    await expect(page.getByTestId('prep-meter')).toBeVisible();
    await expect.poll(async () => Number(await page.getByTestId('prep-meter').getAttribute('data-songs-ready')), { timeout: 30_000 }).toBeGreaterThan(0);
    const state = await game.setup({ theme: 'video game music', players: ['Solo'] });
    expect(state.pack?.source).toBe('mock');
    expect(state.questions.every(question => question.clip?.status === 'ready')).toBe(true);
    await expect(page.getByTestId('round-banner')).toContainText('VIDEO GAME MUSIC');
  });

  test('microphone noise and host echo are not taken as answers', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    await game.waitForAnswering();
    for (const noise of ['.', 'Thank you.', 'hmm', 'uh', 'you']) await game.say(noise);
    await page.waitForTimeout(800);
    expect((await game.state()).phase).toBe('ANSWERING');
    // Speaker bleed: the host's line coming straight back through the mic is dropped.
    await page.getByTestId('hint').click();
    await game.expectHostSaid(/Hint: Clue 1/);
    const hintLine = (await game.hostLines()).find(line => line.startsWith('Hint:'))!;
    await game.say(hintLine);
    await page.waitForTimeout(600);
    expect((await game.state()).phase).toBe('ANSWERING');
    await game.say('alpha');
    await game.waitForPhase('CONFIRMING');
  });
});
