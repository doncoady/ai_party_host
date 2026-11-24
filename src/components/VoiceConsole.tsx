import React, { useEffect, useState } from 'react';
import { Keyboard, Mic, MicOff, Radio, Send } from 'lucide-react';
import { voiceInput, type VoiceInputState } from '../speech/voiceInput.ts';

interface VoiceConsoleProps {
  activePlayerName?: string | null;
  instructionText: string;
  onTyped: (text: string) => void;
}

/**
 * Live status of the microphone plus a typed fallback. Voice is the primary
 * input; typing is always available for quiet rooms, accessibility and tests.
 */
export const VoiceConsole: React.FC<VoiceConsoleProps> = ({ activePlayerName = null, instructionText, onTyped }) => {
  const [voice, setVoice] = useState<VoiceInputState>(voiceInput.getState());
  const [typed, setTyped] = useState('');

  useEffect(() => voiceInput.subscribe(setVoice), []);

  const submitTyped = (event: React.FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    onTyped(text);
    setTyped('');
  };

  const status = voice.connecting
    ? 'CONNECTING TO THE HOST...'
    : voice.transport === 'live'
    ? !voice.live.isListening && voice.live.connection === 'ready'
      ? 'MIC BLOCKED · TYPE BELOW'
      : voice.suppressed
      ? 'HOST AUDIO · MIC PAUSED'
      : voice.userSpeaking
      ? 'LISTENING TO THE ROOM...'
      : voice.live.connection === 'reconnecting'
      ? 'RECONNECTING...'
      : 'LIVE VOICE READY'
    : voice.transport === 'web-speech'
    ? voice.suppressed ? 'MIC PAUSED' : voice.bridging ? 'BROWSER SPEECH · LIVE HOST RECONNECTING' : 'BROWSER SPEECH READY'
    : voice.live.isEnabled && voice.live.connection !== 'ready'
    ? 'LIVE HOST UNAVAILABLE · TYPE BELOW'
    : 'VOICE OFF · TYPE BELOW';

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 py-2" data-testid="voice-console">
      <div className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-3 shadow-xl backdrop-blur-md flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => (voice.transport === 'typed' ? void voiceInput.start() : voiceInput.stop())}
            data-testid="console-mic"
            className={`p-2.5 rounded-full transition-all flex items-center justify-center shrink-0 ${
              voice.transport !== 'typed'
                ? voice.userSpeaking
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 scale-110 ring-4 ring-rose-400 animate-pulse'
                  : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-400'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
            title={voice.transport !== 'typed' ? 'Microphone on — click to pause' : 'Click to enable the microphone'}
          >
            {voice.transport !== 'typed' ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-arcade text-[11px] tracking-wider text-emerald-400" data-testid="voice-status">{status}</span>
              {activePlayerName && (
                <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-arcade text-[10px] border border-rose-500/40 animate-pulse" data-testid="active-player-badge">
                  {activePlayerName} · YOUR TURN
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 font-sans-retro truncate max-w-lg">
              {voice.error ? (
                <span className="text-rose-300" data-testid="voice-error">Voice: {voice.error}</span>
              ) : voice.interimTranscript ? (
                <span className="text-slate-400 italic">…{voice.interimTranscript}</span>
              ) : voice.lastTranscript ? (
                <span>
                  Heard: <strong className="text-yellow-300 font-semibold" data-testid="heard-transcript">"{voice.lastTranscript}"</strong>
                </span>
              ) : (
                <span className="text-slate-500 italic">Waiting for someone to speak…</span>
              )}
            </div>
            <div className="text-[11px] text-cyan-300/90 font-sans-retro truncate max-w-lg" data-testid="voice-instruction">{instructionText}</div>
          </div>
        </div>

        <form onSubmit={submitTyped} className="flex items-center gap-2 w-full md:w-auto" data-testid="typed-form">
          <label className="sr-only" htmlFor="typed-command">Type what you would say</label>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 flex-1 md:w-64 focus-within:border-cyan-500/60">
            <Keyboard className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              id="typed-command"
              data-testid="typed-input"
              value={typed}
              onChange={event => setTyped(event.target.value)}
              placeholder="or type it…"
              className="bg-transparent text-sm font-sans-retro text-slate-100 placeholder:text-slate-600 outline-none w-full"
              autoComplete="off"
            />
          </div>
          <button type="submit" data-testid="typed-submit" className="p-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white" title="Send">
            <Send className="w-4 h-4" />
          </button>
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 font-pixel uppercase bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>{voice.transport === 'live' ? 'GEMINI LIVE' : voice.transport === 'web-speech' ? 'WEB SPEECH' : 'TYPED'}</span>
          </div>
        </form>
      </div>
    </div>
  );
};
