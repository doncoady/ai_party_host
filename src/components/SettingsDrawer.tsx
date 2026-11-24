import React, { useEffect, useState } from 'react';
import { fetchMediaSettings, saveMediaSettings, type MediaSettingsStatus } from '../services/api.ts';
import { Dices, Mic, Play, Save, X } from 'lucide-react';
import { CONFIG_LIMITS, type Difficulty, type GameConfig, type Player } from '../game/types.ts';
import { pickSurpriseTheme } from '../game/commands.ts';

import { GENRE_THEMES } from '../game/commands.ts';

/** Theme pills are music genres; decades, artists and moods work by voice or typing. */
export function themePresets() {
  return GENRE_THEMES;
}

interface SettingsDrawerProps {
  open: boolean;
  config: GameConfig;
  players: Player[];
  inSetup: boolean;
  onClose: () => void;
  onApply: (settings: Partial<GameConfig>, names: string[], start: boolean) => void;
  onMediaSettingsSaved: () => void;
}

/**
 * GUI twin of the voice configuration. Everything here can also be said out
 * loud; the drawer exists for quiet rooms, precision, and accessibility.
 */
export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, config, players, inSetup, onClose, onApply, onMediaSettingsSaved }) => {
  const [theme, setTheme] = useState(config.theme);
  const [playerCount, setPlayerCount] = useState(config.playerCount || 2);
  const [names, setNames] = useState<string[]>(players.map(player => player.name));
  const [rounds, setRounds] = useState(config.rounds);
  const [difficulty, setDifficulty] = useState<Difficulty>(config.difficulty);
  const [turnSeconds, setTurnSeconds] = useState(config.turnSeconds);
  const [clipSeconds, setClipSeconds] = useState(config.clipSeconds);
  const [musicEnabled, setMusicEnabled] = useState(config.musicEnabled);
  const [sfxEnabled, setSfxEnabled] = useState(config.sfxEnabled);
  const [clipPosition, setClipPosition] = useState<'start' | 'hook'>(config.clipPosition);
  const [media, setMedia] = useState<MediaSettingsStatus | null>(null);
  const [songsDir, setSongsDir] = useState('');
  const [preferLocal, setPreferLocal] = useState(false);
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [savingMedia, setSavingMedia] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTheme(config.theme);
    setPlayerCount(config.playerCount || 2);
    setNames(players.map(player => player.name));
    setRounds(config.rounds);
    setDifficulty(config.difficulty);
    setTurnSeconds(config.turnSeconds);
    setClipSeconds(config.clipSeconds);
    setMusicEnabled(config.musicEnabled);
    setSfxEnabled(config.sfxEnabled);
    setClipPosition(config.clipPosition);
    setMediaMessage(null);
    void fetchMediaSettings().then(status => {
      if (!status) return;
      setMedia(status);
      setSongsDir(status.settings.localSongsDir);
      setPreferLocal(status.settings.preferLocal);
    });
    // Snapshot the live config only when the drawer opens so edits are not clobbered mid-game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const collect = (): Partial<GameConfig> => ({
    theme: theme.trim() || undefined,
    playerCount,
    rounds,
    difficulty,
    turnSeconds,
    clipSeconds,
    musicEnabled,
    sfxEnabled,
    clipPosition,
  });

  const saveMedia = async () => {
    setSavingMedia(true);
    setMediaMessage(null);
    try {
      const status = await saveMediaSettings({ localSongsDir: songsDir, preferLocal });
      setMedia(status);
      setMediaMessage(`Saved to .env. Indexed ${status.songs} songs${status.settings.localSongsDir && !status.songsDirExists ? ' (folder not found)' : ''}${status.themes.length ? ` · themes: ${status.themes.slice(0, 6).join(', ')}` : ''}.`);
      onMediaSettingsSaved();
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : 'Could not save media settings');
    } finally {
      setSavingMedia(false);
    }
  };

  const submit = (start: boolean) => {
    onApply(collect(), names.slice(0, playerCount), start);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Game settings" data-testid="settings-drawer">
      <button type="button" className="absolute inset-0 bg-slate-950/70" onClick={onClose} aria-label="Close settings" data-testid="settings-backdrop" />
      <div className="relative w-full max-w-md h-full overflow-y-auto bg-slate-900 border-l border-pink-500/40 shadow-2xl p-5 flex flex-col gap-5 font-sans-retro">
        <div className="flex items-center justify-between">
          <h2 className="font-arcade text-lg text-pink-300">GAME SETTINGS</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-slate-800 text-slate-300" aria-label="Close" data-testid="settings-close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <Mic className="w-3.5 h-3.5 text-emerald-400" /> Everything here can also be said out loud, e.g. “three players, the 90s, hard mode”.
        </p>

        <section className="flex flex-col gap-2">
          <label className="text-xs font-arcade text-cyan-300" htmlFor="settings-theme">THEME</label>
          <div className="flex gap-2">
            <input
              id="settings-theme"
              data-testid="settings-theme"
              value={theme}
              onChange={event => setTheme(event.target.value)}
              placeholder="A decade, genre, franchise, anything…"
              maxLength={60}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            />
            <button type="button" onClick={() => setTheme(pickSurpriseTheme())} className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200" title="Surprise me" data-testid="settings-surprise">
              <Dices className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {themePresets().map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => setTheme(preset)}
                data-testid="settings-theme-preset"
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${theme === preset ? 'border-pink-400 bg-pink-950 text-pink-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}
              >
                {preset}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <span className="text-xs font-arcade text-cyan-300">PLAYERS</span>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(count => (
              <button
                key={count}
                type="button"
                onClick={() => setPlayerCount(count)}
                disabled={!inSetup}
                data-testid={`settings-players-${count}`}
                aria-pressed={playerCount === count}
                className={`flex-1 py-2 rounded-lg font-arcade text-sm border transition-colors disabled:opacity-40 ${playerCount === count ? 'border-emerald-400 bg-emerald-950 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}
              >
                {count}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: playerCount }, (_, index) => (
              <input
                key={index}
                data-testid={`settings-name-${index + 1}`}
                value={names[index] ?? ''}
                disabled={!inSetup}
                onChange={event => setNames(previous => {
                  const next = [...previous];
                  next[index] = event.target.value;
                  return next;
                })}
                placeholder={`Player ${index + 1}`}
                maxLength={24}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-40"
              />
            ))}
          </div>
          {!inSetup && <p className="text-[11px] text-slate-500">Players can be changed after the game ends (say “play again” or “new theme”).</p>}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Range id="settings-rounds" label="QUESTIONS PER PLAYER" value={rounds} min={CONFIG_LIMITS.rounds.min} max={CONFIG_LIMITS.rounds.max} onChange={setRounds} />
          <Range id="settings-turn" label="SECONDS TO ANSWER" value={turnSeconds} min={CONFIG_LIMITS.turnSeconds.min} max={CONFIG_LIMITS.turnSeconds.max} step={5} onChange={setTurnSeconds} />
          <Range id="settings-clip" label="CLIP LENGTH (S)" value={clipSeconds} min={CONFIG_LIMITS.clipSeconds.min} max={CONFIG_LIMITS.clipSeconds.max} onChange={setClipSeconds} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-arcade text-cyan-300" htmlFor="settings-difficulty">DIFFICULTY</label>
            <select
              id="settings-difficulty"
              data-testid="settings-difficulty"
              value={difficulty}
              onChange={event => setDifficulty(event.target.value as Difficulty)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <span className="text-xs font-arcade text-cyan-300">CLIPS</span>
          <div className="flex items-center gap-2 mt-1">
            <label className="text-xs text-slate-300" htmlFor="settings-clip-position">Song clips play</label>
            <select id="settings-clip-position" data-testid="settings-clip-position" value={clipPosition} onChange={event => setClipPosition(event.target.value as 'start' | 'hook')} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500">
              <option value="start">the opening (title rarely sung)</option>
              <option value="hook">the loudest hook</option>
            </select>
          </div>
        </section>

        <section className="flex gap-4">
          <Toggle id="settings-music" label="Background music" checked={musicEnabled} onChange={setMusicEnabled} />
          <Toggle id="settings-sfx" label="Sound effects" checked={sfxEnabled} onChange={setSfxEnabled} />
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="text-xs font-arcade text-cyan-300">MEDIA SOURCES</span>
          <p className="text-xs text-slate-400">Online catalogs (iTunes &amp; Deezer previews) are preferred. A local music folder is a fallback — or the preferred source if you tick the box. Stored in <code>.env</code> as <code>LOCAL_SONGS_DIR</code>; saving re-indexes and rebuilds packs.</p>
          <label className="text-[11px] text-slate-300" htmlFor="settings-songs-dir">Local songs folder (“Artist - Title.mp3”; subfolders and genre tags become themes)</label>
          <input id="settings-songs-dir" data-testid="settings-songs-dir" value={songsDir} onChange={event => setSongsDir(event.target.value)} placeholder="/path/to/music" maxLength={500} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500" />
          <Toggle id="settings-prefer-local" label="Prefer local files over online sources" checked={preferLocal} onChange={setPreferLocal} />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void saveMedia()} disabled={savingMedia} data-testid="settings-media-save" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-arcade disabled:opacity-50">
              {savingMedia ? 'SAVING…' : 'SAVE & RE-INDEX'}
            </button>
            <span className="text-[11px] text-slate-400" data-testid="settings-media-status">
              {mediaMessage ?? (media ? `${media.songs} local songs indexed${media.themes.length ? ` · ${media.themes.slice(0, 5).join(', ')}` : ''}` : '')}
            </span>
          </div>
        </section>

        <div className="mt-auto flex gap-2 pt-4 border-t border-slate-800">
          <button type="button" onClick={() => submit(false)} data-testid="settings-apply" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-arcade text-xs">
            <Save className="w-4 h-4" /> APPLY
          </button>
          {inSetup && (
            <button type="button" onClick={() => submit(true)} data-testid="settings-start" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-arcade text-xs">
              <Play className="w-4 h-4" /> APPLY &amp; START
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Range: React.FC<{ id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }> = ({ id, label, value, min, max, step = 1, onChange }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-arcade text-cyan-300 flex justify-between" htmlFor={id}>
      <span>{label}</span>
      <span className="text-white" data-testid={`${id}-value`}>{value}</span>
    </label>
    <input id={id} data-testid={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} className="accent-pink-500" />
  </div>
);

const Toggle: React.FC<{ id: string; label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ id, label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer" htmlFor={id}>
    <input id={id} data-testid={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="accent-pink-500 w-4 h-4" />
    {label}
  </label>
);
