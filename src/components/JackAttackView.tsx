import React, { useState, useEffect, useRef } from 'react';
import { Player, JackAttackRound, JackAttackPair } from '../game/types.ts';
import { synth } from '../audio/synthEngine.ts';
import { host } from '../audio/speechHost.ts';
import { Sparkles, Zap, Flame } from 'lucide-react';

interface JackAttackViewProps {
  roundData: JackAttackRound;
  players: Player[];
  onPlayerBuzzJack: (playerId: string, isCorrect: boolean) => void;
  onFinishJackAttack: () => void;
}

export const JackAttackView: React.FC<JackAttackViewProps> = ({
  roundData,
  players,
  onPlayerBuzzJack,
  onFinishJackAttack,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeBuzzNotice, setActiveBuzzNotice] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [countdownIntro, setCountdownIntro] = useState(3);
  const [isLockedForPair, setIsLockedForPair] = useState(false);

  const currentPair: JackAttackPair = roundData.pairs[currentIndex % roundData.pairs.length];

  // Intro countdown
  useEffect(() => {
    host.speak(`It's the Jack Attack! Remember, buzz in when the word matches! Two thousand dollars on the line!`);
    const timer = setInterval(() => {
      setCountdownIntro((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setHasStarted(true);
          synth.playFanfare();
          return 0;
        }
        synth.playCountdownTick();
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Word cycling loop
  useEffect(() => {
    if (!hasStarted) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= roundData.pairs.length) {
          clearInterval(interval);
          onFinishJackAttack();
          return prev;
        }
        synth.playCountdownTick();
        setIsLockedForPair(false);
        return next;
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [hasStarted, roundData.pairs.length, onFinishJackAttack]);

  // Buzzer handler for Jack Attack
  const handleBuzz = (playerId: string) => {
    if (!hasStarted || isLockedForPair) return;
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    setIsLockedForPair(true);
    const isCorrect = currentPair.isCorrect;

    if (isCorrect) {
      synth.playCorrect();
      setActiveBuzzNotice(`${player.name} NAILED IT! +$2,000`);
    } else {
      synth.playWrong();
      setActiveBuzzNotice(`${player.name} BOGUS! -$2,000`);
    }

    onPlayerBuzzJack(playerId, isCorrect);
    setTimeout(() => {
      setActiveBuzzNotice(null);
    }, 1500);
  };

  // Keyboard listener for Jack Attack buzzers
  useEffect(() => {
    if (!hasStarted) return;
    const handleKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const p = players.find(player => player.key === key);
      if (p) {
        handleBuzz(p.id);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hasStarted, isLockedForPair, currentPair]);

  if (!hasStarted) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-16 text-center flex flex-col items-center justify-center">
        <div className="p-3 rounded-full bg-pink-900/60 border border-pink-500 mb-4 animate-bounce">
          <Flame className="w-12 h-12 text-yellow-300" />
        </div>
        <h1 className="font-arcade text-4xl sm:text-6xl text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-yellow-300 to-cyan-400 neon-glow-pink mb-4">
          THE JACK ATTACK!
        </h1>
        <p className="text-slate-200 font-sans-retro text-lg sm:text-xl max-w-xl mx-auto mb-6">
          {roundData.clueRule}
        </p>
        <div className="font-arcade text-5xl sm:text-7xl text-yellow-300 tabular-nums neon-glow-yellow animate-pulse">
          {countdownIntro}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 flex flex-col items-center gap-6">
      {/* Jack Attack Banner */}
      <div className="w-full bg-gradient-to-r from-rose-950/90 via-purple-950/90 to-cyan-950/90 border-2 border-pink-500 rounded-2xl p-4 text-center shadow-2xl relative overflow-hidden">
        <div className="flex items-center justify-center gap-2 font-arcade text-xs text-pink-300 uppercase tracking-widest mb-1">
          <Sparkles className="w-4 h-4 text-yellow-300" />
          <span>GRAND FINALE · MATCH OR PAY THE PRICE · $2,000 PER BUZZ</span>
        </div>
        <div className="font-arcade text-2xl sm:text-3xl text-white neon-glow-pink">
          {roundData.topic}
        </div>
      </div>

      {/* Center Target Clue */}
      <div className="w-full bg-slate-900/90 border border-slate-700 rounded-2xl p-6 sm:p-8 text-center shadow-xl">
        <div className="text-xs font-arcade text-cyan-400 uppercase tracking-wider mb-2">
          CLUE SUBJECT:
        </div>
        <div className="font-sans-retro text-2xl sm:text-4xl text-yellow-300 font-black tracking-wide drop-shadow">
          "{currentPair.clue}"
        </div>
      </div>

      {/* Flashing Candidate Match Word */}
      <div className="w-full h-36 sm:h-44 bg-slate-950 border-4 border-yellow-500/60 rounded-3xl p-6 flex flex-col items-center justify-center text-center shadow-2xl relative">
        <div className="text-xs font-arcade text-slate-400 uppercase tracking-widest mb-2">
          IS THIS A MATCH? BUZZ NOW!
        </div>

        <div className="font-arcade text-2xl sm:text-4xl text-white neon-glow-yellow tracking-wider animate-pulse">
          {currentPair.match}
        </div>

        {/* Buzz Notice Banner */}
        {activeBuzzNotice && (
          <div className="absolute inset-0 bg-rose-950/95 rounded-3xl flex items-center justify-center border-4 border-rose-400 shadow-2xl animate-bounce">
            <span className="font-arcade text-xl sm:text-3xl text-white">
              {activeBuzzNotice}
            </span>
          </div>
        )}
      </div>

      {/* Fast Touch Buzzers for in-room players */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
        {players.map((player) => (
          <button
            key={player.id}
            onClick={() => handleBuzz(player.id)}
            style={{ borderColor: player.borderHex, backgroundColor: player.bgHex }}
            className="p-4 rounded-xl border-2 text-white font-arcade text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 hover:brightness-125"
          >
            <Zap className="w-4 h-4 fill-current text-yellow-300" />
            <span>BUZZ {player.name} [{player.key.toUpperCase()}]</span>
          </button>
        ))}
      </div>
    </div>
  );
};
