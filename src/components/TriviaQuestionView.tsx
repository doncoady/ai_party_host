import React from 'react';
import { Question, Player } from '../game/types.ts';
import { Volume2, Play, Disc3, Quote, AlertCircle } from 'lucide-react';
import { AudioVisualizer } from './AudioVisualizer.tsx';

interface TriviaQuestionViewProps {
  question: Question;
  currentPoints: number;
  totalDurationSeconds: number;
  elapsedSeconds: number;
  activeBuzzerPlayer: Player | null;
  buzzerSecondsRemaining: number;
  onSelectOption: (optionIndex: number) => void;
  onPlayAudioClip: () => void;
  isPlayingAudio: boolean;
  isScrewTargetActive?: boolean;
}

export const TriviaQuestionView: React.FC<TriviaQuestionViewProps> = ({
  question,
  currentPoints,
  totalDurationSeconds,
  elapsedSeconds,
  activeBuzzerPlayer,
  buzzerSecondsRemaining,
  onSelectOption,
  onPlayAudioClip,
  isPlayingAudio,
  isScrewTargetActive = false,
}) => {
  const progressRatio = Math.max(0, 1 - elapsedSeconds / totalDurationSeconds);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-4 flex flex-col gap-5">
      {/* Category & Cash Ticker Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/90 border border-pink-500/30 rounded-xl p-3 sm:px-5 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-pink-950 text-pink-300 font-pixel text-sm border border-pink-500/40 uppercase">
            {question.category}
          </span>
          <span className="text-slate-400 text-xs font-arcade hidden sm:inline">· {question.title}</span>
        </div>

        {/* Live Cash Ticker */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-arcade text-slate-400">VALUE:</span>
          <div className="font-arcade text-2xl sm:text-3xl text-emerald-400 neon-glow-cyan tabular-nums tracking-wider animate-pulse">
            ${currentPoints.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Progress Bar Ticker */}
      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
        <div
          className={`h-full transition-all duration-200 ${
            progressRatio > 0.4 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-amber-500 to-rose-500'
          }`}
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      {/* Buzzed-in Player Urgent Banner */}
      {activeBuzzerPlayer && (
        <div
          style={{ borderColor: activeBuzzerPlayer.borderHex }}
          className="p-3 sm:p-4 rounded-xl border-2 bg-rose-950/90 shadow-xl shadow-rose-900/40 flex items-center justify-between gap-4 animate-pulse"
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl">{activeBuzzerPlayer.avatar}</span>
            <div>
              <div className="font-arcade text-base sm:text-lg text-white">
                {activeBuzzerPlayer.name.toUpperCase()} BUZZED IN!
              </div>
              <div className="text-xs text-rose-300 font-sans-retro">
                {isScrewTargetActive ? 'SCREWED! Must answer or lose cash!' : 'Pick your answer now or speak it!'}
              </div>
            </div>
          </div>

          <div className="text-center px-4 py-1.5 rounded-lg bg-rose-900 border border-rose-400 text-white font-arcade text-xl tabular-nums">
            {buzzerSecondsRemaining}s
          </div>
        </div>
      )}

      {/* Audio / Sound Byte interactive media block */}
      {question.type === 'SONG_CLIP' && (
        <div className="bg-slate-900/95 border-2 border-cyan-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <Disc3 className={`w-8 h-8 text-cyan-400 ${isPlayingAudio ? 'animate-spin' : ''}`} />
            <div>
              <div className="font-arcade text-xs text-cyan-300">ACTUAL 80s SONG MASTER CLIP</div>
              <div className="text-xs text-slate-300 font-sans-retro">Official recording from the original 80s track!</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AudioVisualizer isActive={isPlayingAudio} color="cyan" height={40} />
            <button
              onClick={onPlayAudioClip}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-arcade text-xs flex items-center gap-2 cursor-pointer transition-all shadow-md active:scale-95 shrink-0"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{isPlayingAudio ? 'PLAYING...' : 'REPLAY CLIP'}</span>
            </button>
          </div>
        </div>
      )}

      {question.type === 'SOUND_BYTE' && (
        <div className="bg-slate-900/95 border-2 border-yellow-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <Quote className="w-8 h-8 text-yellow-400 shrink-0" />
            <div>
              <div className="font-arcade text-xs text-yellow-300">AUTHENTIC 80s CHARACTER SOUND BYTE</div>
              <div className="text-sm font-sans-retro italic text-white font-bold">"{question.soundByteQuote}"</div>
              {question.characterSilhouetteHint && (
                <div className="text-xs text-slate-400 mt-0.5">Character: {question.characterSilhouetteHint}</div>
              )}
            </div>
          </div>

          <button
            onClick={onPlayAudioClip}
            className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-arcade text-xs flex items-center gap-2 cursor-pointer transition-all shadow-md active:scale-95 shrink-0"
          >
            <Volume2 className="w-4 h-4" />
            <span>PLAY SOUND BYTE</span>
          </button>
        </div>
      )}

      {/* Question Text */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl text-center">
        <h2 className="font-sans-retro text-xl sm:text-2xl md:text-3xl text-white font-bold leading-snug">
          {question.question}
        </h2>
      </div>

      {/* Multiple Choice Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {question.options.map((option, idx) => {
          const letter = ['A', 'B', 'C', 'D'][idx];
          const isClickable = true;

          return (
            <button
              key={idx}
              onClick={() => onSelectOption(idx)}
              className="p-4 rounded-xl border text-left flex items-center gap-3 transition-all bg-slate-900/90 hover:bg-pink-950/80 border-slate-700 hover:border-pink-500 cursor-pointer hover:scale-[1.02] shadow-md group"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-arcade text-xs text-pink-400 shrink-0 shadow-inner">
                {letter}
              </div>
              <div className="flex-1 font-sans-retro text-sm sm:text-base text-slate-100 font-semibold">
                {option}
              </div>
              <div className="text-[10px] text-slate-500 font-pixel uppercase">
                [{idx + 1}]
              </div>
            </button>
          );
        })}
      </div>

      {/* Sponsor Tag */}
      {question.sponsorTitle && (
        <div className="text-center py-2 px-4 rounded-lg bg-slate-950 border border-slate-900 text-xs text-slate-400 font-sans-retro flex items-center justify-center gap-2">
          <span className="font-arcade text-[10px] text-pink-400 uppercase">SPONSOR:</span>
          <span>{question.sponsorTitle} — {question.sponsorCopy}</span>
        </div>
      )}
    </div>
  );
};
