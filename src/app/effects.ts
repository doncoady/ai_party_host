import confetti from 'canvas-confetti';
import { host } from '../audio/speechHost.ts';
import { media } from '../audio/mediaEngine.ts';
import { liveVoice } from '../speech/liveVoice.ts';
import { judgeAnswer, loadThemePack } from '../services/api.ts';
import type { Effect, GameEvent, GameState } from '../game/engine.ts';
import type { Question } from '../game/types.ts';
import type { EffectRunner } from './store.ts';

/**
 * Executes engine effects against the real world (audio, network, UI).
 * Everything here is fire-and-forget; completions come back as events.
 */
export function createEffectRunner(): EffectRunner {
  let packRequestId = 0;

  return (effect: Effect, dispatch: (event: GameEvent) => void, state: GameState) => {
    switch (effect.type) {
      case 'speak': {
        const startedAt = Date.now();
        host.speak(effect.text, {
          improv: effect.improv,
          style: effect.style,
          interrupt: effect.interrupt !== false,
          onEnd: () => {
            const done = () => dispatch({ type: 'SPEECH_DONE', seq: effect.seq, continuation: effect.continuation });
            const remaining = (effect.minDurationMs ?? 0) - (Date.now() - startedAt);
            if (remaining > 0) window.setTimeout(done, remaining);
            else done();
          },
        });
        return;
      }
      case 'sfx':
        void media.playEffect(effect.name);
        return;
      case 'stop-audio':
        media.stopCurrentClip();
        return;
      case 'play-clip':
        void playAuthenticClip(effect.question, effect.seconds, failed => dispatch({ type: 'MEDIA_DONE', seq: effect.seq, failed }));
        return;
      case 'load-pack': {
        const requestId = ++packRequestId;
        dispatch({ type: 'PACK_LOADING' });
        void loadThemePack(effect.themeQuery, effect.difficulty, state.config.clipSeconds, { exclude: effect.exclude, clipPosition: state.config.clipPosition })
          .then(result => {
            if (requestId !== packRequestId) return;
            dispatch({ type: 'PACK_READY', pack: result.pack });
          })
          .catch(error => {
            if (requestId !== packRequestId) return;
            const message = error instanceof Error ? error.message : 'Could not load the theme';
            // No silent swap to a different theme: the host explains and asks for another one.
            dispatch({ type: 'PACK_FAILED', error: message });
          });
        return;
      }
      case 'judge':
        void judgeAnswer(effect.question, effect.transcript).then(optionIndex => {
          dispatch({ type: 'JUDGED', seq: effect.seq, optionIndex });
        });
        return;
      case 'music':
        media.setMusicEnabled(effect.enabled);
        return;
      case 'sfx-enabled':
        media.setSfxEnabled(effect.enabled);
        return;
      case 'mute':
        media.setMasterMuted(effect.muted);
        host.setMuted(effect.muted);
        return;
      case 'celebrate':
        try {
          confetti({ particleCount: 140, spread: 85, origin: { y: 0.6 }, colors: ['#ec4899', '#06b6d4', '#eab308', '#10b981'] });
        } catch {
          // confetti is cosmetic
        }
        return;
      case 'live-theme':
        // The persona follows the theme via inline context on the next host line (no reconnect).
        liveVoice.setTheme(effect.theme);
        return;
      default:
        return;
    }
  };
}

/**
 * Plays the cached authentic excerpt. There is deliberately no synthesized
 * stand-in: if the clip cannot play, the engine swaps or skips the question.
 */
async function playAuthenticClip(question: Question, seconds: number, onDone: (failed: boolean) => void) {
  if (!question.clip || question.clip.status !== 'ready') {
    onDone(true);
    return;
  }
  const playback = media.playClip(question.clip, seconds);
  const result = await playback.done;
  onDone(result === 'failed');
}
