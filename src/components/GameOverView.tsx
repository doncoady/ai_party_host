import React from 'react';
import { RefreshCw, Sparkles, Trophy, Wand2 } from 'lucide-react';
import type { Player } from '../game/types.ts';
import { getPlayerRank, sortByScore } from '../game/rules.ts';

interface GameOverViewProps {
  players: Player[];
  theme: string;
  onSay: (text: string) => void;
}

export const GameOverView: React.FC<GameOverViewProps> = ({ players, theme, onSay }) => {
  const sorted = sortByScore(players);
  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 flex flex-col items-center gap-6" data-testid="game-over-view">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-950/80 border border-yellow-500/50 text-yellow-300 font-arcade text-xs mb-3">
          <Trophy className="w-4 h-4" />
          <span>FINAL SCOREBOARD · {theme.toUpperCase()}</span>
        </div>
        <h1 className="font-arcade text-3xl sm:text-5xl text-white neon-glow-pink">GAME OVER!</h1>
        <p className="text-slate-300 font-sans-retro text-sm sm:text-base mt-2">Here's how everyone stacked up:</p>
      </div>

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
        {sorted.map((player, index) => {
          const rank = getPlayerRank(player.score);
          const isWinner = index === 0;
          return (
            <div
              key={player.id}
              data-testid={`final-${player.id}`}
              data-rank={index + 1}
              style={{ borderColor: isWinner ? '#eab308' : player.borderHex }}
              className={`p-5 rounded-2xl border-2 flex flex-col justify-between shadow-xl ${isWinner ? 'bg-gradient-to-br from-yellow-950/80 via-slate-900 to-pink-950/80 ring-4 ring-yellow-400/50 scale-[1.02]' : 'bg-slate-900/80'}`}
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-arcade text-base sm:text-lg text-yellow-300">#{index + 1}</span>
                    <span className="text-3xl" aria-hidden>{player.avatar}</span>
                    <div className="font-arcade text-base sm:text-lg text-white">{player.name}</div>
                  </div>
                  {isWinner && (
                    <span className="px-2.5 py-1 rounded bg-yellow-500 text-slate-950 font-arcade text-xs font-bold flex items-center gap-1 shadow-md" data-testid="champion-badge">
                      <Sparkles className="w-3 h-3" /> CHAMPION
                    </span>
                  )}
                </div>
                <div className={`my-3 font-arcade text-3xl sm:text-4xl tabular-nums ${player.score < 0 ? 'text-rose-400' : player.score > 0 ? 'text-emerald-400 neon-glow-cyan' : 'text-slate-300'}`}>
                  {player.score < 0 ? `-$${Math.abs(player.score).toLocaleString()}` : `$${player.score.toLocaleString()}`}
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 my-2">
                  <div className="font-arcade text-xs text-yellow-400 flex items-center gap-1.5 mb-1">
                    <span>{rank.icon}</span>
                    <span>{rank.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans-retro">{rank.subtitle}</p>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-pixel">
                <span>CORRECT: {player.correctCount}</span>
                <span>FINAL: ${player.score.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <p className="font-arcade text-xs uppercase tracking-widest text-cyan-300">Say “play again” or “new theme”</p>
        <button type="button" onClick={() => onSay('play again')} data-testid="play-again" className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-sans-retro flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Play again
        </button>
        <button type="button" onClick={() => onSay('new theme')} data-testid="new-theme" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-sans-retro flex items-center gap-1">
          <Wand2 className="w-3.5 h-3.5" /> New theme
        </button>
      </div>
    </div>
  );
};
