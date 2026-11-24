import React, { useState } from 'react';
import { Dices, Loader2, Mic, Music2, Users } from 'lucide-react';
import { prepProgress, type GameState } from '../game/engine.ts';
import { themePresets } from './SettingsDrawer.tsx';

interface SetupViewProps {
  state: GameState;
  onSay: (text: string) => void;
  onPlayerCount: (count: number) => void;
  onPlayerName: (name: string, index: number) => void;
}

/**
 * Voice-first setup. Each step shows what to say; the small GUI controls under
 * the prompt are the secondary path and dispatch the same events.
 */
export const SetupView: React.FC<SetupViewProps> = ({ state, onSay, onPlayerCount, onPlayerName }) => {
  const [themeInput, setThemeInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const phase = state.phase;
  const currentPlayer = state.players[state.setupPlayerIndex];

  return (
    <section className="w-full max-w-3xl mx-auto px-4 py-6" data-testid={`setup-${phase.toLowerCase().replace(/_/g, '-')}`}>
      <div className="rounded-2xl border-2 border-pink-500/40 bg-slate-900/90 p-6 sm:p-10 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-950 text-cyan-300">
          {phase === 'THEME' ? <Music2 className="h-7 w-7" /> : phase === 'PLAYER_COUNT' ? <Users className="h-7 w-7" /> : phase === 'PREPARING' ? <Loader2 className="h-7 w-7 animate-spin" /> : <Mic className="h-7 w-7" />}
        </div>

        {phase === 'THEME' && (
          <>
            <h1 className="font-arcade text-2xl sm:text-3xl text-white">PICK A MUSIC THEME</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">
              Say a genre, a decade, an artist… or <em>“surprise me”</em>.
            </p>
            <p className="mt-1 text-xs text-slate-500 font-sans-retro">Tip: you can add settings in the same breath, e.g. “country, three players, hard mode”.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {themePresets().map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSay(preset)}
                  data-testid="theme-chip"
                  className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300 hover:border-pink-400 hover:text-pink-200 transition-colors"
                >
                  {preset}
                </button>
              ))}
              <button type="button" onClick={() => onSay('surprise me')} data-testid="theme-surprise" className="rounded-full border border-pink-500/60 bg-pink-950/60 px-3 py-1 text-xs text-pink-200 flex items-center gap-1">
                <Dices className="w-3.5 h-3.5" /> Surprise me
              </button>
            </div>
            <form
              className="mt-4 flex justify-center gap-2"
              onSubmit={event => {
                event.preventDefault();
                if (themeInput.trim()) onSay(themeInput.trim());
                setThemeInput('');
              }}
            >
              <input
                value={themeInput}
                onChange={event => setThemeInput(event.target.value)}
                data-testid="theme-input"
                placeholder="…or type a theme"
                maxLength={60}
                className="w-64 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
              />
              <button type="submit" data-testid="theme-submit" className="px-3 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-arcade">SET</button>
            </form>
          </>
        )}

        {phase === 'PLAYER_COUNT' && (
          <>
            <p className="font-arcade text-xs tracking-widest text-pink-300" data-testid="setup-theme-label">THEME: {state.config.theme.toUpperCase()}</p>
            <PrepMeter state={state} compact />
            <h1 className="mt-3 font-arcade text-2xl sm:text-3xl text-white">HOW MANY PLAYERS?</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">Say one, two, three, or four.</p>
            <div className="mt-5 flex justify-center gap-2">
              {[1, 2, 3, 4].map(count => (
                <button
                  key={count}
                  type="button"
                  onClick={() => onPlayerCount(count)}
                  data-testid={`player-count-${count}`}
                  className="h-12 w-12 rounded-xl border border-slate-700 bg-slate-950 font-arcade text-lg text-slate-200 hover:border-emerald-400 hover:text-emerald-200 transition-colors"
                >
                  {count}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === 'PLAYER_NAMES' && currentPlayer && (
          <>
            <p className="font-arcade text-xs tracking-widest text-pink-300">
              PLAYER {state.setupPlayerIndex + 1} OF {state.players.length}
            </p>
            <PrepMeter state={state} compact />
            <h1 className="mt-3 font-arcade text-2xl sm:text-3xl text-white">{state.setupPlayerIndex === 0 ? "WHO'S PLAYING?" : 'PASS THE MIC'}</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">Say your name or nickname.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {state.players.map((player, index) => (
                <span
                  key={player.id}
                  data-testid={`roster-${player.id}`}
                  className={`rounded-full border px-3 py-1 text-xs ${index === state.setupPlayerIndex ? 'border-pink-400 bg-pink-950 text-pink-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}
                >
                  {player.avatar} {player.name || `Player ${index + 1}`}
                </span>
              ))}
            </div>
            <form
              className="mt-4 flex justify-center gap-2"
              onSubmit={event => {
                event.preventDefault();
                if (nameInput.trim()) onPlayerName(nameInput.trim(), state.setupPlayerIndex);
                setNameInput('');
              }}
            >
              <input
                value={nameInput}
                onChange={event => setNameInput(event.target.value)}
                data-testid="name-input"
                placeholder="…or type a name"
                maxLength={24}
                className="w-56 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
              />
              <button type="submit" data-testid="name-submit" className="px-3 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-arcade">OK</button>
            </form>
            <button type="button" onClick={() => onSay('quick start')} data-testid="quick-start" className="mt-3 text-xs text-slate-500 hover:text-slate-300 underline">
              Skip names (quick start)
            </button>
          </>
        )}

        {phase === 'PREPARING' && (
          <>
            <p className="font-arcade text-xs tracking-widest text-pink-300">THEME: {state.config.theme.toUpperCase()}</p>
            <h1 className="mt-3 font-arcade text-2xl sm:text-3xl text-white">CACHING THE SHOW</h1>
            <p className="mt-3 text-slate-300 font-sans-retro">
              {state.packStatus === 'error'
                ? 'Hmm, that theme did not work. Try another one.'
                : state.packStatus !== 'ready'
                ? 'Writing questions…'
                : 'Caching song clips. Round one starts as soon as its clips are in; the rest keep caching in the background.'}
            </p>
            <PrepMeter state={state} />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {state.players.map(player => (
                <span key={player.id} className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                  {player.avatar} {player.name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

/** Shows how many of the theme's song clips are cached (and where they came from); visible from the moment a theme is chosen. */
const PrepMeter: React.FC<{ state: GameState; compact?: boolean }> = ({ state, compact = false }) => {
  if (!state.config.theme) return null;
  const progress = prepProgress(state.pack);
  const loading = state.packStatus === 'loading' || state.packStatus === 'idle';
  const total = progress.ready + progress.pending + progress.failed;
  const label = loading
    ? 'Finding songs…'
    : `${progress.ready}/${total} song clips cached${progress.ready ? ` · ${progress.online} online, ${progress.local} local` : ''}`;
  return (
    <div className={`mx-auto ${compact ? 'mt-2 max-w-sm' : 'mt-5 max-w-md'}`} data-testid="prep-meter" data-songs-ready={progress.ready}>
      <p className="text-[11px] font-sans-retro text-slate-400">{label}</p>
      {!loading && <div className="mt-1.5"><Bar label="TUNES" ready={progress.ready} total={total} color="bg-cyan-400" /></div>}
    </div>
  );
};

const Bar: React.FC<{ label: string; ready: number; total: number; color: string }> = ({ label, ready, total, color }) => (
  <div>
    <div className="flex justify-between font-arcade text-[10px] text-slate-400"><span>{label}</span><span>{ready}/{total}</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
    </div>
  </div>
);
