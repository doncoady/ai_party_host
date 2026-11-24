import { createInitialState, reduce, type Effect, type GameEvent, type GameState } from '../game/engine.ts';

export type EffectRunner = (effect: Effect, dispatch: (event: GameEvent) => void, state: GameState) => void;

/**
 * Minimal external store around the pure reducer. Effects are executed after
 * the state has been updated, in order, and may dispatch further events.
 */
export function createStore(initial: GameState = createInitialState()) {
  let state = initial;
  let runner: EffectRunner | null = null;
  const listeners = new Set<() => void>();
  const queue: GameEvent[] = [];
  let draining = false;

  const dispatch = (event: GameEvent) => {
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const next = queue.shift()!;
        const result = reduce(state, next);
        const changed = result.state !== state;
        state = result.state;
        if (changed) listeners.forEach(listener => listener());
        if (runner) {
          for (const effect of result.effects) {
            try {
              runner(effect, dispatch, state);
            } catch (error) {
              console.error('Effect failed:', effect.type, error);
            }
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    getState: () => state,
    dispatch,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEffectRunner: (next: EffectRunner | null) => {
      runner = next;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
