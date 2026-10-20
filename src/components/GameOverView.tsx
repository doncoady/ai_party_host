import React, { useEffect } from 'react';
import { Player } from '../game/types.ts';
import { getPlayerRank } from '../game/rules.ts';
import { Trophy, RotateCcw, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { synth } from '../audio/synthEngine.ts';
import { host } from '../audio/speechHost.ts';

interface GameOverViewProps {
  players: Player[];
  onPlayAgain: () => void;
}

export const GameOverView: React.FC<GameOverViewProps> = ({
  players,
  onPlayAgain,
}) => {
  // Sort players descending by score
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  useEffect(() => {
    synth.playFanfare();
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#ec4899', '#06b6d4', '#eab308', '#10b981'],
    });

    const closingRoast = winner.score > 0
      ? `That wraps up the show! ${winner.name} takes the crown with $${winner.score.toLocaleString()}! Go buy yourself a cassette deck and celebrate!`
      : `Game over! You all managed to finish in debt. Blockbuster is coming for your kneecaps!`;
    host.speak(closingRoast);
  }, [winner]);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 flex flex-col items-center gap-8">
      {/* Grand Title Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-950/80 border border-yellow-500/50 text-yellow-300 font-arcade text-xs mb-3">
          <Trophy className="w-4 h-4" />
          <span>FINAL SCOREBOARD & 80s SUPERLATIVES</span>
        </div>

        <h1 className="font-arcade text-3xl sm:text-5xl text-white neon-glow-pink">
          GAME OVER, DUDES!
        </h1>
        <p className="text-slate-300 font-sans-retro text-sm sm:text-base mt-2">
          The 1980s have been officially conquered. Here's how everyone stacked up:
        </p>
      </div>

      {/* Podium Grid */}
      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
        {sorted.map((player, idx) => {
          const rank = getPlayerRank(player.score);
          const isWinner = idx === 0;

          return (
            <div
              key={player.id}
              style={{ borderColor: isWinner ? '#eab308' : player.borderHex }}
              className={`p-5 rounded-2xl border-2 flex flex-col justify-between shadow-xl transition-all ${
                isWinner
                  ? 'bg-gradient-to-br from-yellow-950/80 via-slate-900 to-pink-950/80 ring-4 ring-yellow-400/50 scale-[1.02]'
                  : 'bg-slate-900/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-arcade text-base sm:text-lg text-yellow-300">
                      #{idx + 1}
                    </span>
                    <span className="text-3xl">{player.avatar}</span>
                    <div className="font-arcade text-base sm:text-lg text-white">
                      {player.name}
                    </div>
                  </div>

                  {isWinner && (
                    <span className="px-2.5 py-1 rounded bg-yellow-500 text-slate-950 font-arcade text-xs font-bold flex items-center gap-1 shadow-md">
                      <Sparkles className="w-3 h-3" />
                      <span>CHAMPION</span>
                    </span>
                  )}
                </div>

                {/* Score */}
                <div className="my-3">
                  <div
                    className={`font-arcade text-3xl sm:text-4xl tabular-nums ${
                      player.score < 0
                        ? 'text-rose-400'
                        : player.score > 0
                        ? 'text-emerald-400 neon-glow-cyan'
                        : 'text-slate-300'
                    }`}
                  >
                    {player.score < 0 ? `-$${Math.abs(player.score).toLocaleString()}` : `$${player.score.toLocaleString()}`}
                  </div>
                </div>

                {/* Superlative title */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 my-2">
                  <div className="font-arcade text-xs text-yellow-400 flex items-center gap-1.5 mb-1">
                    <span>{rank.icon}</span>
                    <span>{rank.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans-retro">
                    {rank.subtitle}
                  </p>
                </div>
              </div>

              {/* Stats Footer */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-pixel">
                <span>BUZZES: {player.buzzCount}</span>
                <span>CORRECT: {player.correctCount}</span>
                <span>SCREWS: {1 - player.screwsRemaining}/1 USED</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Restart CTA */}
      <button
        data-start="true"
        onClick={onPlayAgain}
        className="px-8 py-4 rounded-xl bg-gradient-to-r from-pink-600 via-rose-500 to-yellow-500 hover:from-pink-500 hover:to-yellow-400 text-white font-arcade text-base sm:text-lg tracking-wider shadow-xl shadow-pink-600/30 flex items-center gap-3 transition-all hover:scale-105 active:scale-95 cursor-pointer ring-2 ring-yellow-400"
      >
        <RotateCcw className="w-5 h-5" />
        <span>PLAY ANOTHER SHOW</span>
      </button>
    </div>
  );
};
