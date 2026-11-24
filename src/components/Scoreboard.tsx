import React from 'react';
import type { Player } from '../game/types.ts';

interface ScoreboardProps {
  players: Player[];
  activePlayerId?: string | null;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ players, activePlayerId = null }) => {
  if (!players.length) return null;
  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-4" data-testid="scoreboard">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${players.length}, minmax(0, 1fr))` }}>
        {players.map(player => {
          const active = player.id === activePlayerId;
          return (
            <div
              key={player.id}
              data-testid={`score-${player.id}`}
              data-active={active ? 'true' : 'false'}
              style={{ borderColor: active ? player.borderHex : 'rgba(51, 65, 85, 0.8)', backgroundColor: active ? `${player.bgHex}cc` : 'rgba(2, 6, 23, 0.7)' }}
              className={`rounded-xl border-2 px-3 py-2 flex items-center justify-between gap-2 transition-all ${active ? 'scale-[1.02] shadow-lg' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl" aria-hidden>{player.avatar}</span>
                <span className="font-arcade text-xs sm:text-sm text-white truncate">{player.name || '—'}</span>
              </div>
              <span className={`font-arcade text-sm sm:text-base tabular-nums ${player.score < 0 ? 'text-rose-400' : 'text-emerald-300'}`} data-testid={`score-value-${player.id}`}>
                {player.score < 0 ? `-$${Math.abs(player.score).toLocaleString()}` : `$${player.score.toLocaleString()}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
