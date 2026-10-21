import React from 'react';
import { Question, Player } from '../game/types.ts';
import { CheckCircle2, XCircle, Sparkles, Clock3 } from 'lucide-react';

interface AnswerRevealViewProps {
  question: Question;
  selectedOptionIndex: number | null;
  buzzedPlayer: Player | null;
  pointsChanged: number;
  hostRoastText: string;
  isLastQuestion: boolean;
  timedOut: boolean;
}

export const AnswerRevealView: React.FC<AnswerRevealViewProps> = ({
  question,
  selectedOptionIndex,
  buzzedPlayer,
  pointsChanged,
  hostRoastText,
  isLastQuestion,
  timedOut,
}) => {
  const isCorrect = selectedOptionIndex === question.correctIndex;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6 items-center">
      {/* Result Status Banner */}
      <div
        className={`w-full p-4 sm:p-5 rounded-2xl border-2 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left shadow-2xl ${
          timedOut
            ? 'bg-amber-950/90 border-amber-500 text-amber-200'
            : isCorrect
            ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
            : 'bg-rose-950/90 border-rose-500 text-rose-200'
        }`}
      >
        <div className="flex items-center gap-3">
          {timedOut ? (
            <Clock3 className="w-10 h-10 text-amber-400 shrink-0" />
          ) : isCorrect ? (
            <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-10 h-10 text-rose-400 shrink-0" />
          )}

          <div>
            <div className="font-arcade text-lg sm:text-xl">
              {timedOut
                ? `${buzzedPlayer?.name.toUpperCase()} RAN OUT OF TIME`
                : isCorrect
                ? `${buzzedPlayer?.name.toUpperCase()} NAILED IT!`
                : `${buzzedPlayer?.name.toUpperCase()} MISSED IT!`}
            </div>
            <div className="text-xs font-sans-retro opacity-90">
              {timedOut
                ? 'No answer locked in. The clock waits for no one.'
                : isCorrect
                ? 'Correct answer. Points added to the player score.'
                : 'Not quite. The host will reveal the right answer.'}
            </div>
          </div>
        </div>

        {/* Score delta */}
        <div className="font-arcade text-2xl sm:text-3xl tabular-nums tracking-wider shrink-0">
          {pointsChanged > 0 ? (
            <span className="text-emerald-300">+$ {pointsChanged.toLocaleString()}</span>
          ) : pointsChanged < 0 ? (
            <span className="text-rose-400">-$ {Math.abs(pointsChanged).toLocaleString()}</span>
          ) : (
            <span className="text-slate-400">$0</span>
          )}
        </div>
      </div>

      {/* Correct Answer Highlighting */}
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
        <div className="text-xs font-arcade text-cyan-400 uppercase tracking-wider">
          THE CORRECT ANSWER WAS:
        </div>

        <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/80 flex items-center gap-3">
          <div className="font-sans-retro text-lg sm:text-xl text-emerald-300 font-bold">
            {question.options[question.correctIndex]}
          </div>
        </div>

        {/* Sarcastic Host Roast Card */}
        <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/30 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5 animate-spin" />
          <div>
            <div className="font-arcade text-xs text-yellow-300 mb-1">HOST ROAST:</div>
            <p className="font-sans-retro text-sm text-yellow-100 font-semibold italic">
              "{hostRoastText || question.hostCorrectRoast}"
            </p>
          </div>
        </div>

        {/* Nostalgic 80s Historical Explanation */}
        <div className="text-xs sm:text-sm text-slate-300 font-sans-retro leading-relaxed pt-2 border-t border-slate-800">
          <span className="font-bold text-slate-100">80s Nostalgia Brief: </span>
          {question.explanation}
        </div>
      </div>

      <p className="text-xs font-arcade uppercase tracking-widest text-cyan-300">
        {isLastQuestion ? 'Final scores are next...' : `The host is moving on from ${buzzedPlayer?.name || 'that answer'}...`}
      </p>
    </div>
  );
};
