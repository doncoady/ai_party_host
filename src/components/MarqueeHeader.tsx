import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Music, Radio, Settings, Sparkles, Volume2, VolumeX, Waves } from 'lucide-react';
import { media } from '../audio/mediaEngine.ts';
import { host, type HostSpeechState } from '../audio/speechHost.ts';
import { voiceInput, type VoiceInputState } from '../speech/voiceInput.ts';

interface MarqueeHeaderProps {
  theme: string;
  phaseLabel: string;
  questionNumber: number;
  totalQuestions: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  onToggleMusic: (enabled: boolean) => void;
  onToggleSfx: (enabled: boolean) => void;
  onToggleMute: (muted: boolean) => void;
  onOpenSettings: () => void;
}

export const MarqueeHeader: React.FC<MarqueeHeaderProps> = ({
  theme,
  phaseLabel,
  questionNumber,
  totalQuestions,
  musicEnabled,
  sfxEnabled,
  onToggleMusic,
  onToggleSfx,
  onToggleMute,
  onOpenSettings,
}) => {
  const [isMuted, setIsMuted] = useState(media.getMasterMuted());
  const [voice, setVoice] = useState<VoiceInputState>(voiceInput.getState());
  const [speech, setSpeech] = useState<HostSpeechState>(host.getState());

  useEffect(() => {
    const unsubVoice = voiceInput.subscribe(setVoice);
    const unsubHost = host.subscribe(setSpeech);
    return () => {
      unsubVoice();
      unsubHost();
    };
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    onToggleMute(next);
  };

  const toggleVoice = () => {
    if (voice.transport === 'live' || voice.transport === 'web-speech') voiceInput.stop();
    else void voiceInput.start();
  };

  const micLabel = voice.connecting
    ? 'CONNECTING'
    : voice.transport === 'live'
    ? voice.suppressed ? 'MIC PAUSED' : voice.live.connection === 'reconnecting' ? 'RECONNECTING' : 'LIVE HOST'
    : voice.transport === 'web-speech'
    ? 'BROWSER MIC'
    : 'TYPED INPUT';
  const micOn = voice.transport !== 'typed';

  return (
    <header className="w-full bg-slate-950/95 border-b border-pink-500/30 sticky top-0 z-40 shadow-lg shadow-pink-950/20 backdrop-blur" data-testid="header">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex items-center justify-between gap-3 text-xs font-sans-retro">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 font-arcade tracking-wider text-pink-400 neon-glow-pink text-sm sm:text-base shrink-0">
            <Radio className="w-4 h-4 text-pink-400 animate-pulse" />
            <span>AI PARTY HOST</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-slate-400 font-pixel text-base min-w-0">
            <span>·</span>
            <span className="text-cyan-400 font-bold truncate" data-testid="header-theme">{theme || 'PICK A THEME'}</span>
            <span>·</span>
            <span data-testid="header-phase">{phaseLabel}</span>
            {totalQuestions > 0 && (
              <>
                <span>·</span>
                <span data-testid="header-progress">Q{questionNumber}/{totalQuestions}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={toggleVoice}
            data-testid="mic-toggle"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
              micOn ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50' : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title={micOn ? 'Turn voice input off' : 'Turn voice input on'}
          >
            {micOn ? <Mic className={`w-3.5 h-3.5 text-emerald-400 ${voice.userSpeaking ? 'animate-bounce' : ''}`} /> : <MicOff className="w-3.5 h-3.5 text-slate-500" />}
            <span className="hidden md:inline font-semibold">{micLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleMusic(!musicEnabled)}
            data-testid="music-toggle"
            aria-pressed={musicEnabled}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              musicEnabled ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50' : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title="Toggle background music"
          >
            <Music className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">MUSIC</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleSfx(!sfxEnabled)}
            data-testid="sfx-toggle"
            aria-pressed={sfxEnabled}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              sfxEnabled ? 'bg-purple-950/80 text-purple-300 border border-purple-500/50' : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title="Toggle sound effects"
          >
            <Waves className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SFX</span>
          </button>

          <button
            type="button"
            onClick={toggleMute}
            data-testid="mute-toggle"
            aria-pressed={isMuted}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-slate-300 hover:text-white border border-slate-800 transition-colors"
            title={isMuted ? 'Unmute audio' : 'Mute audio'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-pink-400" />}
            <span className="hidden sm:inline">{isMuted ? 'UNMUTE' : 'MUTE'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            data-testid="settings-open"
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-slate-300 hover:text-white border border-slate-800 transition-colors"
            title="Game settings"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SETTINGS</span>
          </button>
        </div>
      </div>

      {(speech.subtitle || speech.lastLine) && (
        <div
          className={`bg-gradient-to-r from-pink-950/70 via-purple-950/80 to-cyan-950/70 border-t border-pink-500/40 px-4 py-2 transition-opacity ${speech.subtitle ? 'opacity-100' : 'opacity-60'}`}
          data-testid="host-subtitle"
          data-speaking={speech.subtitle ? 'true' : 'false'}
          aria-live="polite"
        >
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-pink-600 text-white font-arcade text-xs shrink-0 shadow-sm">
              <Sparkles className={`w-3 h-3 ${speech.isSpeaking ? 'animate-spin' : ''}`} />
              <span>HOST</span>
            </div>
            <p className="text-sm md:text-base font-sans-retro text-yellow-300 font-semibold tracking-wide drop-shadow line-clamp-2">
              {speech.subtitle || speech.lastLine}
            </p>
          </div>
        </div>
      )}
    </header>
  );
};
