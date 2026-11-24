import React from 'react';
import { CheckCircle2, Clock3, SkipForward, Sparkles, XCircle } from 'lucide-react';
import type { GameState } from '../game/engine.ts';
import { clipSourceLabel, currentQuestion } from '../game/engine.ts';

interface RevealViewProps {
  state: GameState;
  onSay: (text: string) => void;
}

export const RevealView: React.FC<RevealViewProps> = ({ state, onSay }) => {
  const question = currentQuestion(state);
  const result = state.lastResult;
  if (!question || !result) return null;
  const isLast = state.questionIndex + 1 >= state.questions.length;
  const tone = result.outcome === 'correct'
    ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
    : result.outcome === 'wrong'
    ? 'bg-rose-950/90 border-rose-500 text-rose-200'
    : 'bg-amber-950/90 border-amber-500 text-amber-200';
  const headline = result.outcome === 'correct'
    ? `${result.playerName.toUpperCase()} NAILED IT!`
    : result.outcome === 'wrong'
    ? `${result.playerName.toUpperCase()} MISSED IT!`
    : result.outcome === 'timeout'
    ? `${result.playerName.toUpperCase()} RAN OUT OF TIME`
    : `${result.playerName.toUpperCase()} PASSED`;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-4 flex flex-col gap-5 items-center" data-testid="reveal-view" data-outcome={result.outcome}>
      <div className={`w-full p-4 sm:p-5 rounded-2xl border-2 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left shadow-2xl ${tone}`}>
        <div className="flex items-center gap-3">
          {result.outcome === 'correct' ? <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" /> : result.outcome === 'wrong' ? <XCircle className="w-10 h-10 text-rose-400 shrink-0" /> : <Clock3 className="w-10 h-10 text-amber-400 shrink-0" />}
          <div>
            <div className="font-arcade text-lg sm:text-xl" data-testid="reveal-headline">{headline}</div>
            <div className="text-xs font-sans-retro opacity-90">
              {result.transcript ? <>You said: “{result.transcript}”</> : result.outcome === 'timeout' ? 'No answer locked in. The clock waits for no one.' : 'No answer given.'}
            </div>
          </div>
        </div>
        <div className="font-arcade text-2xl sm:text-3xl tabular-nums tracking-wider shrink-0" data-testid="reveal-delta">
          {result.delta > 0 ? <span className="text-emerald-300">+${result.delta.toLocaleString()}</span> : result.delta < 0 ? <span className="text-rose-400">-${Math.abs(result.delta).toLocaleString()}</span> : <span className="text-slate-400">$0</span>}
          {result.bonus > 0 && <div className="text-xs text-yellow-300 font-sans-retro">includes ${result.bonus.toLocaleString()} streak bonus</div>}
        </div>
      </div>

      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="text-xs font-arcade text-cyan-400 uppercase tracking-wider">THE CORRECT ANSWER WAS:</div>
        <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/80">
          <div className="font-sans-retro text-lg sm:text-xl text-emerald-300 font-bold" data-testid="correct-answer">{question.options[question.correctIndex]}</div>
        </div>
        <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/30 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-arcade text-xs text-yellow-300 mb-1">HOST SAYS:</div>
            <p className="font-sans-retro text-sm text-yellow-100 font-semibold italic" data-testid="host-roast">
              “{result.outcome === 'correct' ? question.hostCorrectRoast : question.hostWrongRoast}”
            </p>
          </div>
        </div>
        <div className="text-xs sm:text-sm text-slate-300 font-sans-retro leading-relaxed pt-2 border-t border-slate-800">
          <span className="font-bold text-slate-100">Did you know? </span>
          {question.explanation}
          {question.clip?.sourceTitle && (
            <span className="block mt-1 text-[11px] text-slate-500">Clip: {question.clip.sourceTitle} · {clipSourceLabel(question.clip).label}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <p className="text-xs font-arcade uppercase tracking-widest text-cyan-300">{isLast ? 'Final scores are next…' : 'The host is moving on…'}</p>
        <button type="button" onClick={() => onSay('next')} data-testid="next" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-sans-retro flex items-center gap-1">
          <SkipForward className="w-3.5 h-3.5" /> Next
        </button>
      </div>
    </div>
  );
};
