import React from 'react';
import { Disc3, HelpCircle, Lightbulb, RotateCcw, SkipForward } from 'lucide-react';
import type { GameState } from '../game/engine.ts';
import { MAX_HINTS, MAX_REPLAYS, WARNING_SECONDS, activePlayer, clipSourceLabel, currentQuestion, currentRound } from '../game/engine.ts';
import { AudioVisualizer } from './AudioVisualizer.tsx';

interface QuestionViewProps {
  state: GameState;
  secondsRemaining: number | null;
  onSay: (text: string) => void;
}

export const QuestionView: React.FC<QuestionViewProps> = ({ state, secondsRemaining, onSay }) => {
  const question = currentQuestion(state);
  const player = activePlayer(state);
  if (!question || !player) return null;
  const phase = state.phase;
  const confirming = phase === 'CONFIRMING';
  const total = state.clock?.totalMs ? state.clock.totalMs / 1000 : state.config.turnSeconds;
  const progress = secondsRemaining === null ? 100 : Math.max(0, (secondsRemaining / total) * 100);
  const urgent = !confirming && secondsRemaining !== null && secondsRemaining <= WARNING_SECONDS;
  const Icon = Disc3;
  const isPlayingMedia = phase === 'CLUE';
  const heard = state.pendingAnswer ? (state.pendingAnswer.optionIndex !== null ? question.options[state.pendingAnswer.optionIndex] : state.pendingAnswer.transcript) : null;
  const canReplay = (phase === 'ANSWERING' || phase === 'CONFIRMING') && state.replaysUsed < MAX_REPLAYS;
  const canHint = phase === 'ANSWERING' && state.hintsUsed < MAX_HINTS;
  const round = currentRound(state) + 1;

  const prompt = phase === 'QUESTION_INTRO'
    ? 'Listen to the host…'
    : phase === 'CLUE'
    ? 'Name that tune…'
    : phase === 'JUDGING'
    ? 'Hmm, let me think about that answer…'
    : confirming
    ? `Final answer, ${player.name}? Say yes to lock it in or no to change it.`
    : 'Say the song or the artist.';

  return (
    <section className="w-full max-w-3xl mx-auto px-4 py-4" data-testid="question-view" data-phase={phase}>
      <div style={{ borderColor: player.borderHex }} className="rounded-2xl border-2 bg-slate-900/95 p-6 sm:p-9 text-center shadow-2xl">
        <p className="mb-4 inline-block rounded-full border border-pink-500/40 bg-pink-950/40 px-3 py-1 font-arcade text-[11px] tracking-widest text-pink-200" data-testid="round-banner">
          ROUND {round} · {state.config.theme.toUpperCase()}
        </p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl" aria-hidden>{player.avatar}</span>
          <div className="text-left">
            <p className="font-pixel text-xs uppercase tracking-widest text-cyan-300" data-testid="question-category">
              {question.category} · ${question.basePoints.toLocaleString()}
            </p>
            <h1 className="mt-1 font-arcade text-xl sm:text-2xl text-white" data-testid="active-player-name">
              {player.name.toUpperCase()}, YOU'RE UP
            </h1>
          </div>
        </div>

        <div className="my-6 flex flex-col items-center gap-3">
          <Icon className={`h-8 w-8 text-cyan-300 ${isPlayingMedia ? 'animate-pulse' : ''}`} />
          {isPlayingMedia && <AudioVisualizer isActive color="cyan" height={36} />}
          <p className="font-sans-retro text-lg sm:text-xl text-white" data-testid="question-prompt">{prompt}</p>
          {phase !== 'QUESTION_INTRO' && phase !== 'CLUE' && (
            <p className="text-sm text-slate-400 font-sans-retro" data-testid="question-text">{question.question}</p>
          )}
          {question.clip && phase !== 'QUESTION_INTRO' && (() => {
            const source = clipSourceLabel(question.clip);
            return source.label ? (
              <p className="text-[11px] font-sans-retro" data-testid="clip-source" data-source-kind={source.kind}>
                <span className={`inline-block rounded px-1.5 py-0.5 border ${source.kind === 'local' ? 'border-amber-500/60 text-amber-300' : 'border-emerald-500/60 text-emerald-300'}`}>{source.label.toUpperCase()}</span>
                {question.clip.label && <span className="ml-2 text-slate-500">{question.clip.label}</span>}
              </p>
            ) : null;
          })()}
          {heard && (
            <p className="rounded-lg bg-yellow-950/50 border border-yellow-500/40 px-3 py-1.5 text-sm text-yellow-200 font-sans-retro" data-testid="pending-answer">
              I heard: <strong>{heard}</strong>
            </p>
          )}
        </div>

        <div className="mx-auto max-w-xl">
          <div className="mb-2 flex justify-between font-arcade text-xs text-slate-300">
            <span>{confirming ? 'CONFIRM YOUR ANSWER' : secondsRemaining === null ? 'GET READY' : 'CLOCK IS TICKING'}</span>
            <span className={urgent ? 'text-rose-400 animate-pulse' : 'text-cyan-300'} data-testid="clock">
              {secondsRemaining === null ? '--' : `${secondsRemaining}s`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full transition-[width] duration-200 ${urgent ? 'bg-rose-500' : confirming ? 'bg-yellow-400' : 'bg-cyan-400'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>

        {(phase === 'ANSWERING' || phase === 'CONFIRMING') && (
          <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs font-sans-retro" data-testid="answer-controls">
            {confirming ? (
              <>
                <button type="button" onClick={() => onSay('yes')} data-testid="confirm-yes" className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white">Yes, lock it in</button>
                <button type="button" onClick={() => onSay('no')} data-testid="confirm-no" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">No, change it</button>
              </>
            ) : (
              <>
                {canReplay && (
                  <button type="button" onClick={() => onSay('play it again')} data-testid="replay" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1">
                    <RotateCcw className="w-3.5 h-3.5" /> Play it again
                  </button>
                )}
                {canHint && (
                  <button type="button" onClick={() => onSay('hint')} data-testid="hint" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5" /> Hint
                  </button>
                )}
                <button type="button" onClick={() => onSay('pass')} data-testid="pass" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1">
                  <SkipForward className="w-3.5 h-3.5" /> Pass
                </button>
                <button type="button" onClick={() => onSay('help')} data-testid="help" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5" /> Help
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
