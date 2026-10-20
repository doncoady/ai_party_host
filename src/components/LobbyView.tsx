import React, { useState, useEffect } from 'react';
import { Player } from '../game/types.ts';
import { Radio, Mic, Keyboard, Users, Play, Sparkles, Volume2 } from 'lucide-react';
import { synth } from '../audio/synthEngine.ts';
import { host } from '../audio/speechHost.ts';
import { voiceBuzzer } from '../speech/voiceBuzzer.ts';
import { AudioVisualizer } from './AudioVisualizer.tsx';

interface LobbyViewProps {
  players: Player[];
  onUpdatePlayers: (players: Player[]) => void;
  onStartGame: () => void;
}

const AVATAR_OPTIONS = ['🎸', '🕶️', '📼', '🕹️', '📻', '🍕', '👟', '🤖'];

export const LobbyView: React.FC<LobbyViewProps> = ({
  players,
  onUpdatePlayers,
  onStartGame,
}) => {
  const [testBuzzerNotice, setTestBuzzerNotice] = useState<string | null>(null);

  // Allow setting player count (2, 3, 4)
  const setPlayerCount = (count: number) => {
    synth.playCashDing();
    if (count === players.length) return;
    if (count > players.length) {
      // Add players
      const newPlayers = [...players];
      if (count >= 3 && !newPlayers.find(p => p.id === 'p3')) {
        newPlayers.push({
          id: 'p3',
          name: 'Turbo Todd',
          score: 0,
          color: 'cyan',
          borderHex: '#06b6d4',
          bgHex: '#0e7490',
          key: 'z',
          voiceTriggerWords: ['todd', 'turbo', 'blue', 'cyan', 'three'],
          avatar: '🕹️',
          screwsRemaining: 1,
          buzzCount: 0,
          correctCount: 0,
        });
      }
      if (count >= 4 && !newPlayers.find(p => p.id === 'p4')) {
        newPlayers.push({
          id: 'p4',
          name: 'Cassette Cathy',
          score: 0,
          color: 'yellow',
          borderHex: '#eab308',
          bgHex: '#a16207',
          key: 'm',
          voiceTriggerWords: ['cathy', 'cassette', 'yellow', 'four'],
          avatar: '📼',
          screwsRemaining: 1,
          buzzCount: 0,
          correctCount: 0,
        });
      }
      onUpdatePlayers(newPlayers);
    } else {
      onUpdatePlayers(players.slice(0, count));
    }
  };

  const handleNameChange = (id: string, name: string) => {
    onUpdatePlayers(
      players.map(p => {
        if (p.id === id) {
          return {
            ...p,
            name,
            voiceTriggerWords: [name.toLowerCase(), p.color, p.id.replace('p', 'player ')]
          };
        }
        return p;
      })
    );
  };

  const handleAvatarChange = (id: string, avatar: string) => {
    synth.playCountdownTick();
    onUpdatePlayers(
      players.map(p => (p.id === id ? { ...p, avatar } : p))
    );
  };

  // Keyboard test listener in Lobby
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If typing in input, don't trigger buzzer
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toLowerCase();
      const matched = players.find(p => p.key === key);
      if (matched) {
        synth.playBuzzer();
        setTestBuzzerNotice(`${matched.name} buzzed with key [${matched.key.toUpperCase()}]!`);
        window.setTimeout(() => setTestBuzzerNotice(null), 1500);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [players]);

  // Voice test listener in Lobby
  useEffect(() => {
    const unsub = voiceBuzzer.onBuzzerSpoken((transcript) => {
      const lower = transcript.toLowerCase();
      for (const p of players) {
        if (lower.includes(p.name.toLowerCase()) || p.voiceTriggerWords.some(w => lower.includes(w))) {
          synth.playBuzzer();
          setTestBuzzerNotice(`Voice detected! "${transcript}" -> ${p.name} buzzed!`);
          window.setTimeout(() => setTestBuzzerNotice(null), 1800);
          break;
        }
      }
    });

    return () => unsub();
  }, [players]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-10 flex flex-col items-center">
      {/* 80s Title Lockup */}
      <div className="text-center mb-8 relative">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-pink-950/80 border border-pink-500/50 text-pink-300 font-pixel text-lg mb-3 tracking-widest uppercase">
          <Sparkles className="w-4 h-4 text-pink-400 animate-spin" />
          <span>IRREVERENT 80s AUDIO TRIVIA</span>
        </div>

        <h1 className="font-arcade text-3xl sm:text-5xl md:text-6xl text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-yellow-300 to-cyan-400 neon-glow-pink tracking-wider mb-2">
          YOU DON'T KNOW 80s!
        </h1>
        <p className="text-slate-300 font-sans-retro text-sm sm:text-base max-w-xl mx-auto">
          Synchronized audio trivia, iconic 80s song clips, movie sound bytes, and a sarcastic AI host who will roast your mistakes into next decade.
        </p>
      </div>

      {/* Main Configuration Card */}
      <div className="w-full bg-slate-900/90 border-2 border-pink-500/40 rounded-2xl p-5 sm:p-7 shadow-2xl backdrop-blur-md mb-8">
        {/* Top: Player count selector */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-2 text-slate-200 font-arcade text-sm">
            <Users className="w-4 h-4 text-cyan-400" />
            <span>SELECT PLAYER COUNT:</span>
          </div>

          <div className="flex items-center gap-2">
            {[2, 3, 4].map((count) => (
              <button
                key={count}
                onClick={() => setPlayerCount(count)}
                className={`px-4 py-2 rounded-lg font-arcade text-sm transition-all cursor-pointer ${
                  players.length === count
                    ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/40 border border-pink-300 scale-105'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                {count} PLAYERS
              </button>
            ))}
          </div>
        </div>

        {/* Players Roster */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
          {players.map((player, idx) => (
            <div
              key={player.id}
              style={{ borderColor: player.borderHex }}
              className="p-4 rounded-xl border bg-slate-950/80 flex flex-col gap-3 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-arcade text-xs text-slate-400">P{idx + 1}</span>
                  <input
                    type="text"
                    value={player.name}
                    maxLength={16}
                    onChange={(e) => handleNameChange(player.id, e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-sm font-arcade text-white focus:outline-none focus:border-pink-500 w-36 sm:w-44"
                    placeholder="Player Name"
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs font-pixel text-yellow-300 bg-yellow-950/60 px-2 py-0.5 rounded border border-yellow-500/30">
                  <Keyboard className="w-3 h-3" />
                  <span>KEY: [{player.key.toUpperCase()}]</span>
                </div>
              </div>

              {/* Avatar Selector */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-slate-400 font-sans-retro mr-1">Avatar:</span>
                {AVATAR_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleAvatarChange(player.id, emoji)}
                    className={`w-8 h-8 rounded text-lg flex items-center justify-center transition-transform hover:scale-110 cursor-pointer ${
                      player.avatar === emoji
                        ? 'bg-pink-600/50 ring-2 ring-pink-400'
                        : 'bg-slate-800/80 hover:bg-slate-700'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Voice buzzer hint */}
              <div className="text-[11px] text-slate-400 flex items-center gap-1 font-sans-retro">
                <Mic className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>Voice triggers: "{player.name}", "Player {idx + 1}", or "{player.voiceTriggerWords[0]}"</span>
              </div>
            </div>
          ))}
        </div>

        {/* Live Buzzer Testing Station */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/90 rounded-xl p-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs font-arcade text-slate-300">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>TEST YOUR BUZZERS: PRESS YOUR KEY OR SHOUT INTO MIC</span>
            </div>

            <div className="h-7 min-w-[220px] flex items-center justify-center">
              {testBuzzerNotice ? (
                <span className="px-3 py-1 rounded bg-rose-600 text-white font-arcade text-xs shadow-md animate-bounce">
                  ⚡ {testBuzzerNotice}
                </span>
              ) : (
                <span className="text-xs text-slate-500 font-pixel">
                  Keys: Q · P · Z · M or Speak your name
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rules & Features Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mb-8 text-center text-xs font-sans-retro">
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <div className="font-arcade text-cyan-300 mb-1">⏱️ DECREASING CASH TICKER</div>
          <p className="text-slate-400">Questions start at $1,000+ and tick down every second. Fastest buzz gets the biggest bag of cash!</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <div className="font-arcade text-pink-300 mb-1">📻 SYNTH SONGS & VOICES</div>
          <p className="text-slate-400">Recreated 80s song clips and iconic movie sound bytes with live spectrum audio visualization.</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <div className="font-arcade text-amber-300 mb-1">🔩 SCREW YOUR NEIGHBOR</div>
          <p className="text-slate-400">Spend your Screw token to force an opponent to answer in 5 seconds or lose cold hard cash!</p>
        </div>
      </div>

      {/* Start Button */}
      <button
        data-start="true"
        onClick={onStartGame}
        className="px-8 py-4 rounded-xl bg-gradient-to-r from-pink-600 via-rose-500 to-yellow-500 hover:from-pink-500 hover:to-yellow-400 text-white font-arcade text-lg sm:text-xl tracking-wider shadow-xl shadow-pink-600/30 flex items-center gap-3 transition-all hover:scale-105 active:scale-95 cursor-pointer ring-2 ring-yellow-300"
      >
        <Play className="w-5 h-5 fill-current" />
        <span>START 80s GAME SHOW</span>
      </button>

      <p className="text-slate-500 text-xs mt-3 font-pixel">
        PRESS [ENTER] OR [SPACE] TO START · SUPPORTS ?autostart=1
      </p>
    </div>
  );
};
