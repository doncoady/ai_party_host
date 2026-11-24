import type { GameEvent, GameState } from '../game/engine.ts';
import { host } from '../audio/speechHost.ts';
import { voiceInput } from '../speech/voiceInput.ts';
import { liveVoice } from '../speech/liveVoice.ts';
import type { Store } from './store.ts';

/**
 * End-to-end test harness, enabled with `?e2e=1` (or localStorage.partyHostE2E).
 * It lets Playwright "speak" to the game and read the engine state without
 * needing a real microphone. Nothing here runs in normal sessions.
 */
export interface PartyHostHarness {
  version: 1;
  say(text: string): void;
  /** Sends the transcript through the (mock) live socket instead of the typed path. */
  sayLive(text: string): boolean;
  getState(): GameState;
  dispatch(event: GameEvent): void;
  /** Every phase transition seen so far (phase + engine seq), oldest first. */
  history(): Array<{ phase: GameState['phase']; seq: number; at: number }>;
  /**
   * Resolves once the game reaches `phase`. With `afterSeq`, transitions that
   * already happened with seq > afterSeq count too, so fast mock flows never race the test.
   */
  waitForPhase(phase: GameState['phase'], timeoutMs?: number, afterSeq?: number): Promise<GameState>;
  subscribe(listener: (state: GameState) => void): () => void;
  hostSpeed(factor: number): void;
  liveState(): ReturnType<typeof liveVoice.getState>;
  dropLiveSocket(): void;
  /** Every line the host has started saying, oldest first. */
  hostLines(): string[];
}

declare global {
  interface Window {
    __partyHost?: PartyHostHarness;
  }
}

export function isE2E() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('e2e') === '1' || window.localStorage.getItem('partyHostE2E') === '1';
  } catch {
    return false;
  }
}

export function installHarness(store: Store) {
  host.setSpeedFactor(0.25);
  host.setBrowserSpeechEnabled(false);
  const history: Array<{ phase: GameState['phase']; seq: number; at: number }> = [{ phase: store.getState().phase, seq: store.getState().seq, at: Date.now() }];
  store.subscribe(() => {
    const state = store.getState();
    const last = history[history.length - 1];
    if (!last || last.phase !== state.phase || last.seq !== state.seq) history.push({ phase: state.phase, seq: state.seq, at: Date.now() });
    if (history.length > 500) history.splice(0, history.length - 500);
  });
  const hostLines: string[] = [];
  host.subscribe(state => {
    if (state.subtitle && hostLines[hostLines.length - 1] !== state.subtitle) hostLines.push(state.subtitle);
    if (hostLines.length > 500) hostLines.splice(0, hostLines.length - 500);
  });
  const harness: PartyHostHarness = {
    version: 1,
    say: text => voiceInput.inject(text),
    sayLive: text => liveVoice.injectTranscript(text),
    getState: () => store.getState(),
    dispatch: event => store.dispatch(event),
    history: () => [...history],
    waitForPhase: (phase, timeoutMs = 15_000, afterSeq) => new Promise((resolve, reject) => {
      const seen = afterSeq === undefined
        ? store.getState().phase === phase
        : history.some(entry => entry.phase === phase && entry.seq > afterSeq);
      if (seen) {
        resolve(store.getState());
        return;
      }
      const timer = window.setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for phase ${phase}; current phase is ${store.getState().phase}`));
      }, timeoutMs);
      const unsubscribe = store.subscribe(() => {
        if (store.getState().phase !== phase) return;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(store.getState());
      });
    }),
    subscribe: listener => store.subscribe(() => listener(store.getState())),
    hostSpeed: factor => host.setSpeedFactor(factor),
    liveState: () => liveVoice.getState(),
    dropLiveSocket: () => liveVoice.simulateDrop(),
    hostLines: () => [...hostLines],
  };
  window.__partyHost = harness;
  return harness;
}
