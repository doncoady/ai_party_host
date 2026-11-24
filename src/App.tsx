import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createStore } from './app/store.ts';
import { createEffectRunner } from './app/effects.ts';
import { installHarness, isE2E } from './app/harness.ts';
import { activePlayer, clockRemainingMs, describeVoicePrompt, WARNING_SECONDS, type GameState } from './game/engine.ts';
import type { GameConfig } from './game/types.ts';
import { host } from './audio/speechHost.ts';
import { media } from './audio/mediaEngine.ts';
import { voiceInput } from './speech/voiceInput.ts';
import { fetchClipStatuses } from './services/api.ts';
import { predictHostLines } from './game/hostLines.ts';
import { MarqueeHeader } from './components/MarqueeHeader.tsx';
import { VoiceConsole } from './components/VoiceConsole.tsx';
import { Scoreboard } from './components/Scoreboard.tsx';
import { SetupView } from './components/SetupView.tsx';
import { QuestionView } from './components/QuestionView.tsx';
import { RevealView } from './components/RevealView.tsx';
import { GameOverView } from './components/GameOverView.tsx';
import { SettingsDrawer } from './components/SettingsDrawer.tsx';
import { StartOverlay } from './components/StartOverlay.tsx';
import { ThemeBanner } from './components/ThemeBanner.tsx';
import { audioBus } from './audio/audioBus.ts';

const store = createStore();
store.setEffectRunner(createEffectRunner());
if (isE2E()) installHarness(store);

const PHASE_LABELS: Record<GameState['phase'], string> = {
  THEME: 'SETUP',
  PLAYER_COUNT: 'SETUP',
  PLAYER_NAMES: 'SETUP',
  PREPARING: 'LOADING',
  INTRO: 'INTRO',
  QUESTION_INTRO: 'QUESTION',
  CLUE: 'CLUE',
  ANSWERING: 'ANSWER',
  JUDGING: 'ANSWER',
  CONFIRMING: 'CONFIRM',
  REVEAL: 'REVEAL',
  GAME_OVER: 'FINAL',
};

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const dispatch = store.dispatch;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const lastTickSecond = useRef<number | null>(null);

  // ------------------------------------------------------------------ boot
  useEffect(() => {
    document.body.dataset.phase = state.phase.toLowerCase();
    // Silence the music whenever the room is expected to talk: cleaner audio for recognition.
    media.setListening(['THEME', 'PLAYER_COUNT', 'PLAYER_NAMES', 'ANSWERING', 'JUDGING', 'CONFIRMING'].includes(state.phase));
  }, [state.phase]);

  // Boot: if the browser lets audio play right away we start immediately;
  // otherwise a single tap on the overlay unlocks audio + microphone.
  const [needsGesture, setNeedsGesture] = useState<boolean | null>(null);
  const booted = useRef(false);
  const boot = useCallback(() => {
    if (booted.current) return;
    booted.current = true;
    setNeedsGesture(false);
    void media.unlock();
    void voiceInput.start().then(transport => {
      dispatch({ type: 'BOOT', voiceReady: transport !== 'typed' });
    });
  }, [dispatch]);

  useEffect(() => {
    media.preloadSfx();
    const context = audioBus.getContext();
    if (!context || context.state === 'running' || isE2E()) {
      boot();
    } else {
      void context.resume().then(() => {
        if (context.state === 'running') boot();
        else setNeedsGesture(true);
      }).catch(() => setNeedsGesture(true));
    }
    const unlock = () => {
      void media.unlock();
      if (booted.current && store.getState().config.musicEnabled && !media.getBackgroundMusicStatus()) void media.toggleBackgroundMusic(true);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      voiceInput.stop();
      host.stop();
    };
  }, [boot]);

  useEffect(() => voiceInput.onTranscript(text => dispatch({ type: 'TRANSCRIPT', text })), [dispatch]);

  // ----------------------------------------------------------------- clocks
  useEffect(() => {
    const clock = state.clock;
    if (!clock || clock.startedAt === null) {
      lastTickSecond.current = null;
      return;
    }
    const seq = state.seq;
    const tick = () => {
      const now = Date.now();
      const remaining = clockRemainingMs(clock, now) ?? 0;
      setClockNow(now);
      const seconds = Math.ceil(remaining / 1000);
      if (clock.kind === 'turn' && seconds <= WARNING_SECONDS && !clock.warned) dispatch({ type: 'CLOCK_WARNING', seq });
      if (clock.kind === 'turn' && seconds <= 5 && seconds > 0 && lastTickSecond.current !== seconds) {
        lastTickSecond.current = seconds;
        void media.playEffect('tick');
      }
      if (remaining <= 0) dispatch({ type: 'CLOCK_EXPIRED', seq, now });
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [state.clock, state.seq, dispatch]);

  const secondsRemaining = useMemo(() => {
    if (!state.clock) return null;
    const remaining = clockRemainingMs(state.clock, clockNow) ?? 0;
    return Math.max(0, Math.ceil(remaining / 1000));
  }, [state.clock, clockNow]);

  // Pre-render the host lines the next turns will need so they play instantly.
  useEffect(() => {
    if (state.phase === 'THEME') return;
    host.prefetch(predictHostLines(state));
  }, [state.questions, state.questionIndex, state.players, state.roundsPlanned, state.phase]);

  // ------------------------------------------------------------- preloading
  useEffect(() => {
    const upcoming = state.questions.slice(state.questionIndex, state.questionIndex + 3);
    for (const question of upcoming) {
      if (question.clip?.status === 'ready') void media.preloadClip(question.clip);
    }
  }, [state.questions, state.questionIndex]);

  // Background caching: keep every pending clip's status fresh so rounds can be
  // planned from what is actually cached, during setup and during play.
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const question of [...state.questions, ...(state.pack?.questions ?? [])]) {
      if (question.clip?.status === 'pending') ids.add(question.clip.id);
    }
    return Array.from(ids).sort();
  }, [state.questions, state.pack]);
  const pendingKey = pendingIds.join(',');
  useEffect(() => {
    if (!pendingKey) return;
    let cancelled = false;
    const poll = async () => {
      const clips = await fetchClipStatuses(pendingKey.split(','));
      if (cancelled) return;
      const byClipId = new Map(clips.filter(clip => clip.status !== 'pending').map(clip => [clip.id, clip]));
      if (!byClipId.size) return;
      const current = store.getState();
      const updates: Array<{ questionId: string; clip: typeof clips[number] }> = [];
      const seen = new Set<string>();
      for (const question of [...current.questions, ...(current.pack?.questions ?? [])]) {
        const clip = question.clip && byClipId.get(question.clip.id);
        if (clip && !seen.has(question.id)) {
          seen.add(question.id);
          updates.push({ questionId: question.id, clip: { ...question.clip, ...clip } });
        }
      }
      if (updates.length) dispatch({ type: 'CLIP_UPDATED', updates, now: Date.now() });
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingKey, dispatch]);

  // While preparing, keep the engine's wait budget ticking even if no clip changes arrive.
  useEffect(() => {
    if (state.phase !== 'PREPARING') return;
    const timer = window.setInterval(() => dispatch({ type: 'PREP_TICK', now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [state.phase, dispatch]);

  // ---------------------------------------------------------------- actions
  const say = useCallback((text: string) => voiceInput.inject(text), []);
  const applySettings = useCallback((settings: Partial<GameConfig>, names: string[], start: boolean) => {
    dispatch({ type: 'APPLY_SETTINGS', settings, names, start });
  }, [dispatch]);

  const player = activePlayer(state);
  const inSetup = ['THEME', 'PLAYER_COUNT', 'PLAYER_NAMES', 'PREPARING'].includes(state.phase);
  const inQuestion = ['QUESTION_INTRO', 'CLUE', 'ANSWERING', 'JUDGING', 'CONFIRMING'].includes(state.phase);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative selection:bg-pink-500 selection:text-white">
      <div className="fixed inset-0 crt-scanlines z-30 pointer-events-none opacity-40" />
      {needsGesture && <StartOverlay onStart={boot} />}

      <MarqueeHeader
        theme={state.config.theme}
        phaseLabel={PHASE_LABELS[state.phase]}
        questionNumber={Math.min(state.questionIndex + 1, state.questions.length)}
        totalQuestions={state.questions.length}
        musicEnabled={state.config.musicEnabled}
        sfxEnabled={state.config.sfxEnabled}
        onToggleMusic={enabled => dispatch({ type: 'COMMANDS', commands: [{ type: 'music', enabled }], source: 'gui' })}
        onToggleSfx={enabled => dispatch({ type: 'COMMANDS', commands: [{ type: 'sfx', enabled }], source: 'gui' })}
        onToggleMute={muted => dispatch({ type: 'COMMANDS', commands: [{ type: 'mute', muted }], source: 'gui' })}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <VoiceConsole
        activePlayerName={inQuestion ? player?.name : null}
        instructionText={describeVoicePrompt(state)}
        onTyped={say}
      />

      {state.config.theme && <ThemeBanner theme={state.config.theme} round={state.roundsPlanned ? Math.floor(state.questionIndex / Math.max(1, state.players.length)) + 1 : 0} rounds={state.config.rounds} inSetup={inSetup} />}

      {!inSetup && state.players.length > 0 && <Scoreboard players={state.players} activePlayerId={inQuestion || state.phase === 'REVEAL' ? player?.id : null} />}

      <main className="flex-1 flex flex-col justify-center items-center py-2 relative z-20">
        {inSetup && (
          <SetupView
            state={state}
            onSay={say}
            onPlayerCount={count => dispatch({ type: 'COMMANDS', commands: [{ type: 'set-player-count', count }], source: 'gui' })}
            onPlayerName={(name, index) => dispatch({ type: 'SET_PLAYER_NAME', name, playerIndex: index })}
          />
        )}
        {state.phase === 'INTRO' && (
          <section className="w-full max-w-3xl mx-auto px-4 py-6 text-center" data-testid="intro-view">
            <h1 className="font-arcade text-3xl sm:text-4xl text-white neon-glow-pink">{state.config.theme.toUpperCase()}</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">{state.pack?.tagline ?? 'Let the games begin.'}</p>
            <p className="mt-1 text-xs text-slate-500 font-sans-retro">{state.questions.length} questions · {state.players.length} {state.players.length === 1 ? 'player' : 'players'}</p>
          </section>
        )}
        {inQuestion && <QuestionView state={state} secondsRemaining={secondsRemaining} onSay={say} />}
        {state.phase === 'REVEAL' && <RevealView state={state} onSay={say} />}
        {state.phase === 'GAME_OVER' && <GameOverView players={state.players} theme={state.config.theme} onSay={say} />}
      </main>

      <SettingsDrawer
        open={settingsOpen}
        config={state.config}
        players={state.players}
        inSetup={inSetup}
        onClose={() => setSettingsOpen(false)}
        onApply={applySettings}
        onMediaSettingsSaved={() => dispatch({ type: 'MEDIA_SETTINGS_CHANGED' })}
      />
    </div>
  );
}
