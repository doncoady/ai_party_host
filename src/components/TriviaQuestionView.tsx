import React from 'react';
import { Disc3, Mic, Quote } from 'lucide-react';
import type { Player, Question } from '../game/types.ts';
import { AudioVisualizer } from './AudioVisualizer.tsx';

interface TriviaQuestionViewProps {
  question: Question;
  currentPoints: number;
  activeBuzzerPlayer: Player;
  secondsRemaining: number | null;
  isPlayingAudio: boolean;
  isPresentingQuestion: boolean;
  isConfirmingAnswer: boolean;
}

export const TriviaQuestionView: React.FC<TriviaQuestionViewProps> = ({
  question,
  currentPoints,
  activeBuzzerPlayer,
  secondsRemaining,
  isPlayingAudio,
  isPresentingQuestion,
  isConfirmingAnswer,
}) => {
  const progress = secondsRemaining === null
    ? 100
    : Math.max(0, secondsRemaining / (isConfirmingAnswer ? 6 : 20) * 100);
  const AudioIcon = question.type === 'SONG_CLIP' ? Disc3 : question.type === 'SOUND_BYTE' ? Quote : Mic;

  return (
    <section className="w-full max-w-3xl mx-auto px-4 py-6">
      <div
        style={{ borderColor: activeBuzzerPlayer.borderHex }}
        className="rounded-2xl border-2 bg-slate-900/95 p-6 sm:p-9 text-center shadow-2xl"
      >
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl">{activeBuzzerPlayer.avatar}</span>
          <div className="text-left">
            <p className="font-pixel text-xs uppercase tracking-widest text-cyan-300">
              {question.category} · ${currentPoints.toLocaleString()}
            </p>
            <h1 className="mt-1 font-arcade text-xl sm:text-2xl text-white">
              {activeBuzzerPlayer.name.toUpperCase()}, YOU'RE UP
            </h1>
          </div>
        </div>

        <div className="my-7 flex flex-col items-center gap-3">
          <AudioIcon className={`h-8 w-8 text-cyan-300 ${isPlayingAudio ? 'animate-pulse' : ''}`} />
          {isPlayingAudio && <AudioVisualizer isActive color="cyan" height={36} />}
          <p className="font-sans-retro text-lg sm:text-xl text-white">
            {isConfirmingAnswer
              ? `Final answer, ${activeBuzzerPlayer.name}? Say yes to lock it in or no to change it.`
              : isPresentingQuestion
              ? 'Listen closely...'
              : 'Say your answer, then confirm it aloud.'}
          </p>
        </div>

        <div className="mx-auto max-w-xl">
          <div className="mb-2 flex justify-between font-arcade text-xs text-slate-300">
            <span>{isConfirmingAnswer ? 'CONFIRM YOUR ANSWER' : secondsRemaining === null ? 'GET READY' : 'CLOCK IS TICKING'}</span>
            <span className={!isConfirmingAnswer && secondsRemaining !== null && secondsRemaining <= 8 ? 'text-rose-400 animate-pulse' : 'text-cyan-300'}>
              {secondsRemaining === null ? '--' : `${secondsRemaining}s`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-[width] duration-1000 ${secondsRemaining !== null && secondsRemaining <= 8 ? 'bg-rose-500' : 'bg-cyan-400'}`}
              style={{ width: `${isConfirmingAnswer ? 100 : progress}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
