import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive?: boolean;
  color?: string; // 'pink' | 'cyan' | 'emerald' | 'amber'
  height?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isActive = true,
  color = 'cyan',
  height = 48,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      animId = requestAnimationFrame(render);
      const width = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, width, h);

      const numBars = 24;
      const barWidth = width / numBars - 2;

      for (let i = 0; i < numBars; i++) {
        const t = Date.now() / 300;
        const barHeight = isActive ? 4 + (Math.sin(t + i * 0.4) + 1) * h * 0.22 : 4;

        const x = i * (barWidth + 2);
        const y = h - barHeight;

        // Gradient based on chosen neon theme
        const grad = ctx.createLinearGradient(0, y, 0, h);
        if (color === 'pink') {
          grad.addColorStop(0, '#f472b6');
          grad.addColorStop(1, '#db2777');
        } else if (color === 'emerald') {
          grad.addColorStop(0, '#34d399');
          grad.addColorStop(1, '#059669');
        } else if (color === 'amber') {
          grad.addColorStop(0, '#fbbf24');
          grad.addColorStop(1, '#d97706');
        } else {
          grad.addColorStop(0, '#38bdf8');
          grad.addColorStop(1, '#0284c7');
        }

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Cap highlight
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, barWidth, 2);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isActive, color]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={height}
      className="w-full max-w-[280px] rounded bg-slate-900/60 p-1 border border-slate-800"
    />
  );
};
