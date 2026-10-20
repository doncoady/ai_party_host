import React, { useEffect, useState } from 'react';
import { Question, Player } from '../game/types.ts';
import { CheckCircle2, XCircle, ArrowRight, Sparkles, Volume2 } from 'lucide-react';
import { host } from '../audio/speechHost.ts';

interface AnswerRevealViewProps {
  question: Question;
  selectedOptionIndex: number | null;
  buzzedPlayer: Player | null;
  pointsChanged: number;
  hostRoastText: string;
  onNextQuestion: () => void;
  isLastQuestion: boolean;
}

export const AnswerRevealView: React.FC<AnswerRevealViewProps> = ({
  question,
  selectedOptionIndex,
  buzzedPlayer,
  pointsChanged,
  hostRoastText,
  onNextQuestion,
  isLastQuestion,
}) => {
  const [countdown, setCountdown] = useState(8);
  const isCorrect = selectedOptionIndex === question.correctIndex;
  const didTimeExpire = buzzedPlayer === null && selectedOptionIndex === null;

  useEffect(() => {
    if (countdown <= 0) {
      onNextQuestion();
    }
  }, [countdown, onNextQuestion]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6 items-center">
      {/* Result Status Banner */}
      <div
        className={`w-full p-4 sm:p-5 rounded-2xl border-2 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left shadow-2xl ${
          isCorrect
            ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
            : didTimeExpire
            ? 'bg-slate-900 border-slate-700 text-slate-300'
            : 'bg-rose-950/90 border-rose-500 text-rose-200'
        }`}
      >
        <div className="flex items-center gap-3">
          {isCorrect ? (
            <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-10 h-10 text-rose-400 shrink-0" />
          )}

          <div>
            <div className="font-arcade text-lg sm:text-xl">
              {isCorrect
                ? `${buzzedPlayer?.name.toUpperCase()} NAILED IT!`
                : didTimeExpire
                ? 'TIME EXPIRED! NOBODY BUZZED!'
                : `${buzzedPlayer?.name.toUpperCase()} BLEW IT!`}
            </div>
            <div className="text-xs font-sans-retro opacity-90">
              {isCorrect
                ? 'Radical deduction! Points added to player bank.'
                : didTimeExpire
                ? 'You were all too slow. The 80s wait for no one!'
                : 'Totally bogus answer! Penalty deducted from player bank.'}
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
          <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-arcade text-xs flex items-center justify-center shrink-0">
            {['A', 'B', 'C', 'D'][question.correctIndex]}
          </div>
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

      {/* Next Question Button */}
      <button
        onClick={onNextQuestion}
        className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-pink-600 via-rose-500 to-yellow-500 hover:from-pink-500 hover:to-yellow-400 text-white font-arcade text-sm sm:text-base tracking-wider shadow-lg flex items-center gap-2 cursor-pointer transition-all hover:scale-105 active:scale-95 ring-2 ring-yellow-400"
      >
        <span>{isLastQuestion ? 'PROCEED TO JACK ATTACK FINALE' : `NEXT QUESTION (${countdown}s)`}</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};
