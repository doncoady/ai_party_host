import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Mic, MicOff, Music, Radio, Sparkles } from 'lucide-react';
import { media } from '../audio/mediaEngine.ts';
import { host } from '../audio/speechHost.ts';
import { liveVoice, LiveVoiceState } from '../speech/liveVoice.ts';

interface MarqueeHeaderProps {
  currentRoundName?: string;
  questionNumber?: number;
  totalQuestions?: number;
}

export const MarqueeHeader: React.FC<MarqueeHeaderProps> = ({
  currentRoundName = 'ROUND 1',
  questionNumber = 1,
  totalQuestions = 8,
}) => {
  const [isMuted, setIsMuted] = useState(media.getMuted());
  const [isBgmOn, setIsBgmOn] = useState(media.getBackgroundMusicStatus());
  const [voiceState, setVoiceState] = useState<LiveVoiceState>(liveVoice.getState());
  const [hostSubtitle, setHostSubtitle] = useState<string>('');

  useEffect(() => {
    const unsubVoice = liveVoice.subscribe((state) => {
      setVoiceState(state);
    });

    const unsubMusic = media.subscribeBackgroundMusic(setIsBgmOn);
    const unsubHost = host.subscribe((subtitle) => {
      setHostSubtitle(subtitle);
    });

    return () => {
      unsubVoice();
      unsubMusic();
      unsubHost();
    };
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    media.setMuted(next);
    liveVoice.setMuted(next);
    host.setMuted(next);
  };

  const toggleBgm = async () => {
    await media.toggleBackgroundMusic();
    setIsBgmOn(media.getBackgroundMusicStatus());
  };

  const toggleVoice = () => {
    if (voiceState.isEnabled) {
      liveVoice.stop();
    } else {
      void liveVoice.start();
    }
  };

  return (
    <header className="w-full bg-slate-950 border-b border-pink-500/30 sticky top-0 z-40 shadow-lg shadow-pink-950/20">
      {/* Top utility row */}
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-xs font-sans-retro">
        {/* Brand & Round */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-arcade tracking-wider text-pink-400 neon-glow-pink text-sm sm:text-base">
            <Radio className="w-4 h-4 text-pink-400 animate-pulse" />
            <span>YOU DON'T KNOW 80s!</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-slate-400 font-pixel text-base">
            <span>·</span>
            <span className="text-cyan-400 font-bold">{currentRoundName}</span>
            <span>·</span>
            <span>Q{questionNumber}/{totalQuestions}</span>
          </div>
        </div>

        {/* Audio & Voice controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live voice status */}
          <button
            onClick={toggleVoice}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
              voiceState.isEnabled
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title={voiceState.isSupported ? 'Toggle Gemini Live voice' : 'Live voice not supported in this browser'}
          >
            {voiceState.isEnabled ? (
              <>
                <Mic className="w-3.5 h-3.5 text-emerald-400 animate-bounce" />
                <span className="hidden md:inline font-semibold">
                  {voiceState.isPlaybackSuppressed ? 'MIC PAUSED FOR AUDIO' : voiceState.isOutputting ? 'LIVE HOST SPEAKING' : voiceState.isListening ? 'LIVE VOICE ON' : 'CONNECTING...'}
                </span>
                <span className="md:hidden font-semibold">{voiceState.isPlaybackSuppressed ? 'MIC PAUSED' : voiceState.isOutputting ? 'HOST LIVE' : voiceState.isListening ? 'MIC ON' : 'CONNECTING'}</span>
              </>
            ) : (
              <>
                <MicOff className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden md:inline">VOICE INPUT OFF</span>
                <span className="md:hidden">MIC OFF</span>
              </>
            )}
          </button>

          {/* Background Music Toggle */}
          <button
            onClick={() => void toggleBgm()}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              isBgmOn 
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50' 
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
            title="Toggle background music"
          >
            <Music className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">MUSIC</span>
          </button>

          {/* Master Audio Mute */}
          <button
            onClick={toggleMute}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-slate-300 hover:text-white border border-slate-800 transition-colors"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-pink-400" />}
            <span className="hidden sm:inline">{isMuted ? 'UNMUTE' : 'MUTE'}</span>
          </button>
        </div>
      </div>

      {/* Live AI Host Speech / Subtitle Banner */}
      {hostSubtitle && (
        <div className="bg-gradient-to-r from-pink-950/70 via-purple-950/80 to-cyan-950/70 border-t border-pink-500/40 px-4 py-2 transition-all">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-pink-600 text-white font-arcade text-xs shrink-0 shadow-sm">
              <Sparkles className="w-3 h-3 animate-spin" />
              <span>HOST</span>
            </div>
            <p className="text-sm md:text-base font-sans-retro text-yellow-300 font-semibold tracking-wide drop-shadow truncate">
              "{voiceState.outputTranscript || hostSubtitle}"
            </p>
          </div>
        </div>
      )}
    </header>
  );
};
