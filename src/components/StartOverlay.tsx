import React from 'react';
import { Mic, Play } from 'lucide-react';

interface StartOverlayProps {
  onStart: () => void;
}

/**
 * Browsers block audio (and microphone prompts feel random) until the page has
 * been touched once. When the audio context boots suspended we ask for one tap
 * so the host can talk and listen immediately afterwards.
 */
export const StartOverlay: React.FC<StartOverlayProps> = ({ onStart }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/95" data-testid="start-overlay">
    <div className="mx-4 max-w-md rounded-2xl border-2 border-pink-500/50 bg-slate-900 p-8 text-center shadow-2xl">
      <p className="font-arcade text-pink-400 neon-glow-pink text-2xl">AI PARTY HOST</p>
      <p className="mt-3 text-slate-300 font-sans-retro">
        A voice-driven Name That Tune show with real song clips. Tap once so your browser lets the host talk and listen.
      </p>
      <button
        type="button"
        onClick={onStart}
        data-testid="start-button"
        autoFocus
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-pink-600 px-6 py-3 font-arcade text-sm text-white shadow-lg shadow-pink-900/50 hover:bg-pink-500"
      >
        <Play className="h-4 w-4" /> START THE SHOW
      </button>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500 font-sans-retro">
        <Mic className="h-3.5 w-3.5" /> Microphone access is requested next; typing works too.
      </p>
    </div>
  </div>
);
