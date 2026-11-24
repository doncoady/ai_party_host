import { expect, test } from '@playwright/test';

/**
 * Real browsers boot the AudioContext suspended until the page is touched.
 * Headless Chromium does not enforce that, so we simulate it: the context
 * reports "suspended" until resume() is called from a user gesture.
 */
test('a start overlay unlocks audio when the browser blocks autoplay', async ({ page }) => {
  await page.addInitScript(() => {
    let unlocked = false;
    window.addEventListener('pointerdown', () => { unlocked = true; }, { capture: true });
    const stateDescriptor = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state')!;
    Object.defineProperty(BaseAudioContext.prototype, 'state', {
      configurable: true,
      get() {
        const real = stateDescriptor.get!.call(this) as AudioContextState;
        return unlocked ? real : 'suspended';
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('start-overlay')).toBeVisible();
  await expect(page.getByTestId('host-subtitle')).toHaveCount(0);
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('start-overlay')).toBeHidden();
  await expect(page.getByTestId('setup-theme')).toBeVisible();
  await expect(page.getByTestId('host-subtitle')).toContainText(/theme/i, { timeout: 20_000 });
});
