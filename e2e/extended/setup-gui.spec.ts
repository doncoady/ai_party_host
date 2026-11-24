import { expect, test } from '../fixtures.ts';

test.describe('GUI as the secondary configuration path', () => {
  test('theme chips, player buttons and typed names drive the same flow', async ({ game, page }) => {
    await page.getByTestId('theme-chip').filter({ hasText: 'Disco' }).click();
    await game.waitForPhase('PLAYER_COUNT');
    await expect(page.getByTestId('setup-theme-label')).toContainText('DISCO');

    await page.getByTestId('player-count-2').click();
    await game.waitForPhase('PLAYER_NAMES');

    await page.getByTestId('name-input').fill('Ann');
    await page.getByTestId('name-submit').click();
    await expect(page.getByTestId('roster-p1')).toContainText('Ann');
    await page.getByTestId('name-input').fill('Ben');
    await page.getByTestId('name-submit').click();

    const state = await game.waitForPhase('INTRO', 40_000);
    expect(state.players.map(player => player.name)).toEqual(['Ann', 'Ben']);
    expect(state.config.theme).toBe('Disco');
  });

  test('typed theme input works when nobody wants to talk', async ({ game, page }) => {
    await page.getByTestId('theme-input').fill('sci-fi movies');
    await page.getByTestId('theme-submit').click();
    const state = await game.waitForPhase('PLAYER_COUNT');
    expect(state.config.theme).toBe('Sci-fi Movies');
  });


  test('settings presets and surprise button fill the theme field', async ({ game, page }) => {
    void game;
    await page.getByTestId('settings-open').click();
    await page.getByTestId('settings-theme-preset').filter({ hasText: 'Hip Hop' }).click();
    await expect(page.getByTestId('settings-theme')).toHaveValue('Hip Hop');
    await page.getByTestId('settings-surprise').click();
    await expect(page.getByTestId('settings-theme')).not.toHaveValue('');
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('settings-drawer')).toBeHidden();
  });


  test('header toggles for music, sound effects and mute reflect state', async ({ game, page }) => {
    void game;
    await expect(page.getByTestId('music-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('music-toggle').click();
    await expect(page.getByTestId('music-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('sfx-toggle').click();
    await expect(page.getByTestId('sfx-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('mute-toggle').click();
    await expect(page.getByTestId('mute-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mute-toggle')).toContainText('UNMUTE');
  });
});

test.describe('media sources', () => {
  test('local folders can be configured from the settings drawer and are indexed', async ({ game, page }, testInfo) => {
    void game;
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'e2e-media-'));
    await mkdir(join(root, 'songs', '70s'), { recursive: true });
    await writeFile(join(root, 'songs', '70s', 'ABBA - Dancing Queen.mp3'), 'not really audio');
    testInfo.attachments.push({ name: 'media-root', contentType: 'text/plain', body: Buffer.from(root) });

    await page.getByTestId('settings-open').click();
    await page.getByTestId('settings-songs-dir').fill(join(root, 'songs'));
    await page.getByTestId('settings-prefer-local').check();
    await page.getByTestId('settings-media-save').click();
    await expect(page.getByTestId('settings-media-status')).toContainText(/Saved to \.env\. Indexed 1 songs/);
    await page.getByTestId('settings-close').click();

    const status = await page.request.get('/api/settings');
    const body = await status.json();
    expect(body.songs).toBe(1);
    expect(body.settings.preferLocal).toBe(true);
    // Reset so other tests are unaffected.
    await page.request.put('/api/settings', { data: { localSongsDir: '', preferLocal: false } });
  });
});

test.describe('theme presentation and source badges', () => {
  test('theme pills are music genres and the chosen theme is shown prominently', async ({ game, page }) => {
    await expect(page.getByTestId('theme-chip').filter({ hasText: 'Country' })).toBeVisible();
    await expect(page.getByTestId('theme-chip').filter({ hasText: 'Love Songs' })).toBeVisible();
    await expect(page.getByTestId('theme-chip').filter({ hasText: 'Star Wars' })).toHaveCount(0);
    await expect(page.getByTestId('theme-banner')).toHaveCount(0);
    await page.getByTestId('theme-chip').filter({ hasText: 'Country' }).click();
    await game.waitForPhase('PLAYER_COUNT');
    await expect(page.getByTestId('theme-banner-name')).toHaveText('COUNTRY');
  });

  test('the clip source (online or local) is shown while a clip is in play', async ({ game, page }) => {
    await game.setup({ theme: 'disney movies', players: ['Solo'], extra: 'one round' });
    await game.waitForAnswering();
    await expect(page.getByTestId('clip-source')).toHaveAttribute('data-source-kind', 'online');
    await expect(page.getByTestId('clip-source')).toContainText(/ONLINE/);
  });
});
