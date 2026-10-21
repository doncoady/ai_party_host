import React from 'react';
import { Mic, Users } from 'lucide-react';
import type { Player } from '../game/types.ts';

interface PlayerSetupViewProps {
  step: 'count' | 'names';
  players: Player[];
  currentPlayerIndex: number;
}

export const PlayerSetupView: React.FC<PlayerSetupViewProps> = ({
  step,
  players,
  currentPlayerIndex,
}) => {
  const currentPlayer = players[currentPlayerIndex];

  return (
    <section className="w-full max-w-3xl mx-auto px-4 py-8">
      <div className="rounded-2xl border-2 border-pink-500/40 bg-slate-900/90 p-6 sm:p-10 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-950 text-cyan-300">
          {step === 'count' ? <Users className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
        </div>

        {step === 'count' ? (
          <>
            <h1 className="font-arcade text-2xl sm:text-3xl text-white">HOW MANY PLAYERS?</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">
              The host is ready. Say one, two, three, or four players.
            </p>
          </>
        ) : currentPlayer ? (
          <>
            <p className="font-arcade text-xs tracking-widest text-pink-300">
              PLAYER {currentPlayerIndex + 1} OF {players.length}
            </p>
            <h1 className="mt-3 font-arcade text-2xl sm:text-3xl text-white">
              {currentPlayerIndex === 0 ? "WHO'S PLAYING?" : 'PASS THE MIC'}
            </h1>
            <p className="mt-3 text-slate-300 font-sans-retro">
              {currentPlayerIndex === 0 ? 'Say your name or nickname.' : 'Next player, say your name or nickname.'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {players.map((player, index) => (
                <span
                  key={player.id}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    index === currentPlayerIndex
                      ? 'border-pink-400 bg-pink-950 text-pink-200'
                      : 'border-slate-700 bg-slate-950 text-slate-400'
                  }`}
                >
                  {player.name || `Player ${index + 1}`}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
};
