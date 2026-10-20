import React from 'react';
import { Player } from '../game/types.ts';
import { Zap, AlertTriangle } from 'lucide-react';

interface ScoreboardProps {
  players: Player[];
  activeBuzzerPlayerId: string | null;
  lockedOutPlayerIds: string[];
  isQuestionActive: boolean;
  onPlayerBuzz: (playerId: string) => void;
  onInitiateScrew?: (screwerId: string) => void;
  isScrewTargeting?: boolean;
  screwerId?: string | null;
  onSelectScrewTarget?: (targetId: string) => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  players,
  activeBuzzerPlayerId,
  lockedOutPlayerIds,
  isQuestionActive,
  onPlayerBuzz,
  onInitiateScrew,
  isScrewTargeting = false,
  screwerId = null,
  onSelectScrewTarget,
}) => {
  return (
    <div className="w-full bg-slate-950/90 border-t border-slate-800 p-3 sm:p-4 backdrop-blur-sm shadow-2xl">
      <div className="max-w-6xl mx-auto">
        {/* Screw Targeting Notice */}
        {isScrewTargeting && (
          <div className="mb-3 p-2 bg-amber-950/90 border border-amber-500 rounded text-center text-amber-300 text-sm font-arcade animate-pulse flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>WHO DO YOU WANT TO SCREW?! CLICK AN OPPONENT!</span>
          </div>
        )}

        {/* Players Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {players.map((player) => {
            const isBuzzedIn = activeBuzzerPlayerId === player.id;
            const isLockedOut = lockedOutPlayerIds.includes(player.id);
            const isCurrentScrewer = screwerId === player.id;
            const canBeScrewed = isScrewTargeting && screwerId !== player.id;

            return (
              <div
                key={player.id}
                style={{
                  borderColor: isBuzzedIn ? '#f43f5e' : player.borderHex,
                }}
                className={`relative rounded-xl border-2 p-3 transition-all duration-200 flex flex-col justify-between ${
                  isBuzzedIn
                    ? 'bg-rose-950/90 shadow-lg shadow-rose-600/40 ring-4 ring-rose-500 scale-105 z-10'
                    : isLockedOut
                    ? 'bg-slate-900/40 opacity-50 grayscale border-dashed'
                    : canBeScrewed
                    ? 'bg-amber-950/60 ring-2 ring-amber-400 cursor-pointer animate-pulse'
                    : 'bg-slate-900/80 shadow-md'
                }`}
                onClick={() => {
                  if (canBeScrewed && onSelectScrewTarget) {
                    onSelectScrewTarget(player.id);
                  }
                }}
              >
                {/* Header: Avatar, Name & Screw Tokens */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-2xl select-none" role="img" aria-label="avatar">
                      {player.avatar}
                    </span>
                    <div className="truncate">
                      <div className="font-arcade text-xs text-white truncate tracking-wide">
                        {player.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-pixel uppercase">
                        KEY: [{player.key.toUpperCase()}]
                      </div>
                    </div>
                  </div>

                  {/* Screws Remaining */}
                  <div className="flex items-center gap-1 shrink-0" title={`${player.screwsRemaining} Screws remaining`}>
                    {Array.from({ length: player.screwsRemaining }).map((_, i) => (
                      <span key={i} className="text-xs" role="img" aria-label="screw">
                        🔩
                      </span>
                    ))}
                  </div>
                </div>

                {/* Cash Score Ticker */}
                <div className="my-1.5 text-center">
                  <div
                    className={`font-arcade text-xl sm:text-2xl tabular-nums tracking-wider ${
                      player.score < 0
                        ? 'text-rose-400 neon-glow-pink'
                        : player.score > 0
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {player.score < 0 ? `-$${Math.abs(player.score).toLocaleString()}` : `$${player.score.toLocaleString()}`}
                  </div>
                </div>

                {/* Tactile Buzzer Button */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    disabled={!isQuestionActive || isLockedOut || activeBuzzerPlayerId !== null || isScrewTargeting}
                    onClick={() => onPlayerBuzz(player.id)}
                    style={{
                      backgroundColor: isBuzzedIn ? '#e11d48' : isLockedOut ? '#334155' : player.bgHex,
                      borderColor: player.borderHex,
                    }}
                    className={`w-full py-2 px-3 rounded-lg border font-arcade text-xs text-white uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-md ${
                      isQuestionActive && !isLockedOut && activeBuzzerPlayerId === null
                        ? 'hover:brightness-125 cursor-pointer ring-1 ring-white/20'
                        : 'opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <Zap className={`w-3.5 h-3.5 ${isBuzzedIn ? 'animate-bounce text-yellow-300' : ''}`} />
                    <span>{isBuzzedIn ? 'BUZZED!' : isLockedOut ? 'LOCKED OUT' : `BUZZ [${player.key.toUpperCase()}]`}</span>
                  </button>

                  {/* Screw Button (if player has screws and question is active) */}
                  {onInitiateScrew && player.screwsRemaining > 0 && isQuestionActive && !isLockedOut && (
                    <button
                      onClick={() => onInitiateScrew(player.id)}
                      disabled={isScrewTargeting || isBuzzedIn}
                      className="p-2 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-white border border-amber-400 text-xs font-arcade transition-all cursor-pointer shrink-0"
                      title="Screw an opponent! Forces them to answer under 5 seconds"
                    >
                      🔩
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
