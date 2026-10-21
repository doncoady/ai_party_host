import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Radio } from 'lucide-react';
import { liveVoice, LiveVoiceState } from '../speech/liveVoice.ts';

interface LiveVoiceConsoleProps {
  activePlayerBuzzedName?: string | null;
  instructionText?: string;
  className?: string;
}

export const LiveVoiceConsole: React.FC<LiveVoiceConsoleProps> = ({
  activePlayerBuzzedName = null,
  instructionText = 'Speak your answer or say the host command.',
  className = '',
}) => {
  const [voiceState, setVoiceState] = useState<LiveVoiceState>(liveVoice.getState());

  useEffect(() => {
    return liveVoice.subscribe((s) => {
      setVoiceState(s);
    });
  }, []);

  const handleToggleMic = () => {
    if (voiceState.isEnabled) {
      liveVoice.stop();
    } else {
      void liveVoice.start();
    }
  };

  return (
    <div className={`w-full max-w-4xl mx-auto px-4 py-2 ${className}`}>
      <div className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-3 shadow-xl backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Live Mic Status & Listening Wave */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={handleToggleMic}
            className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 ${
              voiceState.isEnabled
                ? voiceState.isSpeaking
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 scale-110 ring-4 ring-rose-400 animate-pulse'
                  : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-400'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={voiceState.isEnabled ? 'Microphone enabled — Click to pause' : 'Click to Enable Microphone'}
          >
            {voiceState.isEnabled ? (
              <Mic className={`w-5 h-5 ${voiceState.isSpeaking ? 'animate-bounce' : ''}`} />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-arcade text-xs tracking-wider text-emerald-400">
                {voiceState.isPlaybackSuppressed
                  ? 'HOST AUDIO · MIC PAUSED'
                  : voiceState.isSpeaking
                  ? 'LISTENING TO ROOM...'
                  : voiceState.isListening
                  ? 'LIVE VOICE READY'
                  : voiceState.isEnabled
                  ? 'CONNECTING TO LIVE HOST...'
                  : voiceState.isSupported
                  ? 'MIC MUTED'
                  : 'VOICE NOT SUPPORTED'}
              </span>
              {activePlayerBuzzedName && (
                <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-arcade text-[10px] border border-rose-500/40 animate-pulse">
                  {activePlayerBuzzedName} · YOUR TURN
                </span>
              )}
            </div>

            {/* Live Transcript Display */}
            <div className="text-xs text-slate-300 font-sans-retro truncate max-w-md">
              {voiceState.errorMessage ? (
                <span className="text-rose-300">Live voice error: {voiceState.errorMessage}</span>
              ) : voiceState.lastTranscript ? (
                <span>
                  Heard: <strong className="text-yellow-300 font-semibold">"{voiceState.lastTranscript}"</strong>
                </span>
              ) : (
                <span className="text-slate-500 italic">
                  {instructionText}
                </span>
              )}
            </div>
            {voiceState.outputTranscript && (
              <div className="text-xs text-cyan-200 font-sans-retro truncate max-w-md">
                Host: {voiceState.outputTranscript}
              </div>
            )}
          </div>
        </div>

        {/* Spoken prompt */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 font-pixel uppercase bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>VOICE-ONLY GAME</span>
          </div>
        </div>
      </div>
    </div>
  );
};
