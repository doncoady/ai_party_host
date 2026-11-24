import { test as base, expect, type Page } from '@playwright/test';
import type { GameState } from '../src/game/engine.ts';

type Phase = GameState['phase'];

/**
 * Game driver used by every spec. It talks to the in-page harness
 * (window.__partyHost) so tests can "speak" and observe engine state.
 */
export class GameDriver {
  private mark = -1;

  constructor(readonly page: Page) {}

  async open(path = '/?e2e=1') {
    await this.page.goto(path);
    await this.page.waitForFunction(() => Boolean(window.__partyHost));
    // Wait for the live (mock) host to connect so voice flows use the socket path.
    await this.page.waitForFunction(() => window.__partyHost!.liveState().connection === 'ready', null, { timeout: 20_000 });
    await this.waitForPhase('THEME');
    this.mark = await this.seq();
  }

  async seq() {
    return this.page.evaluate(() => window.__partyHost!.getState().seq);
  }

  async state() {
    return this.page.evaluate(() => window.__partyHost!.getState());
  }

  /** Speaks through the mock live socket (input transcript path). */
  async say(text: string) {
    this.mark = await this.seq();
    const ok = await this.page.evaluate(value => window.__partyHost!.sayLive(value), text);
    if (!ok) throw new Error(`Live injection unavailable for "${text}"`);
    // The mock server emits an utterance as fragments over ~60 ms; keep utterances from interleaving.
    await this.page.waitForTimeout(90);
  }

  /** Types into the fallback command box (typed transport). */
  async type(text: string) {
    this.mark = await this.seq();
    await this.page.getByTestId('typed-input').fill(text);
    await this.page.getByTestId('typed-submit').click();
  }

  /** Waits for a phase reached after the last say/type. */
  async waitForPhase(phase: Phase, timeoutMs = 30_000) {
    const state = await this.page.evaluate(
      ([target, timeout, after]) => window.__partyHost!.waitForPhase(target as Phase, timeout as number, after as number),
      [phase, timeoutMs, this.mark],
    );
    this.mark = state.seq;
    return state;
  }

  async history() {
    return this.page.evaluate(() => window.__partyHost!.history().map(entry => entry.phase));
  }

  async hostLines() {
    return this.page.evaluate(() => window.__partyHost!.hostLines());
  }

  /** Asserts the host said a matching line (lines can be very short-lived with the mock host). */
  async expectHostSaid(pattern: RegExp, timeoutMs = 10_000) {
    await expect.poll(async () => (await this.hostLines()).some(line => pattern.test(line)), { timeout: timeoutMs, message: `host line matching ${pattern}` }).toBe(true);
  }

  /** Fast path through setup: theme → players → names. */
  async setup(options: { theme?: string; players?: string[]; extra?: string } = {}) {
    const names = options.players ?? ['Alice', 'Bob'];
    await this.say(`${options.theme ?? 'disney movies'}, ${names.length} player${names.length === 1 ? '' : 's'}${options.extra ? `, ${options.extra}` : ''}`);
    await this.waitForPhase('PLAYER_NAMES');
    for (const name of names) {
      await this.say(name);
      await this.page.waitForTimeout(150);
    }
    return this.waitForPhase('INTRO', 40_000);
  }

  /** Plays through the intro and clue until the player may answer. */
  async waitForAnswering(timeoutMs = 40_000) {
    return this.waitForPhase('ANSWERING', timeoutMs);
  }
}

export const test = base.extend<{ game: GameDriver }>({
  game: async ({ page }, use) => {
    const driver = new GameDriver(page);
    await driver.open();
    await use(driver);
  },
});

export { expect };
