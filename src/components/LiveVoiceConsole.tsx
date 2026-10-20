import React, { useEffect, useState } from 'react';
import { Mic, MicOff, MessageSquare, Sparkles, Volume2, Radio } from 'lucide-react';
import { voiceBuzzer, VoiceRecognitionState } from '../speech/voiceBuzzer.ts';

interface LiveVoiceConsoleProps {
  onDirectSpokenText?: (transcript: string) => void;
  isHostSpeaking?: boolean;
  activePlayerBuzzedName?: string | null;
  className?: string;
}

export const LiveVoiceConsole: React.FC<LiveVoiceConsoleProps> = ({
  onDirectSpokenText,
  isHostSpeaking = false,
  activePlayerBuzzedName = null,
  className = '',
}) => {
  const [voiceState, setVoiceState] = useState<VoiceRecognitionState>(voiceBuzzer.getState());
  const [manualInput, setManualInput] = useState('');
  const [showManualVoiceInput, setShowManualVoiceInput] = useState(false);

  useEffect(() => {
    return voiceBuzzer.subscribe((s) => {
      setVoiceState(s);
    });
  }, []);

  const handleToggleMic = () => {
    if (voiceState.isListening) {
      voiceBuzzer.stop();
    } else {
      voiceBuzzer.start();
    }
  };

  const handleSendManualSpeech = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    if (onDirectSpokenText) {
      onDirectSpokenText(manualInput.trim());
    }
    setManualInput('');
  };

  return (
    <div className={`w-full max-w-4xl mx-auto px-4 py-2 ${className}`}>
      <div className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-3 shadow-xl backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Live Mic Status & Listening Wave */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={handleToggleMic}
            className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 ${
              voiceState.isListening
                ? voiceState.isSpeaking
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 scale-110 ring-4 ring-rose-400 animate-pulse'
                  : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-400'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={voiceState.isListening ? 'Microphone Active — Click to pause' : 'Click to Enable Microphone'}
          >
            {voiceState.isListening ? (
              <Mic className={`w-5 h-5 ${voiceState.isSpeaking ? 'animate-bounce' : ''}`} />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-arcade text-xs tracking-wider text-emerald-400">
                {voiceState.isSpeaking ? 'LISTENING TO ROOM...' : voiceState.isListening ? 'VOICE READY (HANDS-FREE)' : 'MIC MUTED'}
              </span>
              {activePlayerBuzzedName && (
                <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-arcade text-[10px] border border-rose-500/40 animate-pulse">
                  {activePlayerBuzzedName} SPEAK ANSWER!
                </span>
              )}
            </div>

            {/* Live Transcript Display */}
            <div className="text-xs text-slate-300 font-sans-retro truncate max-w-md">
              {voiceState.lastTranscript ? (
                <span>
                  Heard: <strong className="text-yellow-300 font-semibold">"{voiceState.lastTranscript}"</strong>
                </span>
              ) : (
                <span className="text-slate-500 italic">
                  Shout your name to buzz, say the answer, or chat with the host!
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Quick Spoken Cheatsheet & Push-To-Talk Fallback */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 font-pixel uppercase bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>VOICE: "BUZZ!" · "[NAME]" · "[ANSWER]" · "SCREW [NAME]"</span>
          </div>

          <button
            onClick={() => setShowManualVoiceInput(!showManualVoiceInput)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-arcade transition-colors cursor-pointer"
            title="Type spoken text if mic is unavailable"
          >
            {showManualVoiceInput ? 'HIDE TYPE' : 'TYPE SPEECH'}
          </button>
        </div>
      </div>

      {/* Optional fallback input for testing without microphone */}
      {showManualVoiceInput && (
        <form onSubmit={handleSendManualSpeech} className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Type what you would say into the mic (e.g. 'Player 1 buzz', 'Ferris Bueller', 'Screw Rick')..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500 font-sans-retro"
          />
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-arcade text-xs transition-colors cursor-pointer"
          >
            SPEAK TO HOST
          </button>
        </form>
      )}
    </div>
  );
};
