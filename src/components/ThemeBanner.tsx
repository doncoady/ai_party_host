import React from 'react';
import { Music2 } from 'lucide-react';

interface ThemeBannerProps {
  theme: string;
  round: number;
  rounds: number;
  inSetup: boolean;
}

/** The current music theme, front and centre for the whole room. */
export const ThemeBanner: React.FC<ThemeBannerProps> = ({ theme, round, rounds, inSetup }) => (
  <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 pt-2" data-testid="theme-banner">
    <div className="rounded-xl border border-pink-500/40 bg-gradient-to-r from-pink-950/70 via-slate-900 to-cyan-950/70 px-4 py-2 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-3 min-w-0">
        <Music2 className="w-5 h-5 text-pink-400 shrink-0" />
        <div className="min-w-0">
          <p className="font-pixel text-xs uppercase tracking-widest text-slate-400">Name That Tune · {inSetup ? 'tonight\'s theme' : 'now playing'}</p>
          <p className="font-arcade text-xl sm:text-2xl text-white neon-glow-pink truncate" data-testid="theme-banner-name">{theme.toUpperCase()}</p>
        </div>
      </div>
      {!inSetup && round > 0 && (
        <span className="font-arcade text-xs text-cyan-300 shrink-0" data-testid="theme-banner-round">ROUND {round}/{rounds}</span>
      )}
    </div>
  </div>
);
