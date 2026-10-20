// Studio-Grade 80s Polyphonic Audio Engine (Multi-Track Drum Machines, FM Slap Bass, Polyphonic Chords & Studio FX)

class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private isMuted: boolean = false;
  private bgmGain: GainNode | null = null;
  private bgmInterval: number | null = null;
  private isBgmPlaying: boolean = false;
  private currentClipStopFn: (() => void) | null = null;

  public init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.bgmGain) {
      this.bgmGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
    } else if (!muted && this.bgmGain && this.isBgmPlaying) {
      this.bgmGain.gain.setValueAtTime(0.08, this.ctx?.currentTime || 0);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public getAnalyserData(): Uint8Array | null {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  private getDestination(): AudioNode {
    this.init();
    return this.analyser || this.ctx!.destination;
  }

  // --- Studio Sound Effects (Authentic Studio FX) ---

  /**
   * Authentic Game Show Low Klaxon Buzzer
   */
  public playBuzzer() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Dual-tone aggressive klaxon (150Hz + 195Hz with subtle distortion)
    [150, 195].forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.9, now + 0.35);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(now);
      osc.stop(now + 0.36);
    });
  }

  /**
   * Studio Chime + Cash Ding
   */
  public playCorrect() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Bright stereo bell chime arpeggio (C5, G5, C6, E6)
    const notes = [523.25, 783.99, 1046.50, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);

      gain.gain.setValueAtTime(0.22, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.45);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.5);
    });

    // Also trigger subtle crowd cheer
    this.playCrowdCheer(0.6);
  }

  /**
   * Sarcastic Studio Fail Buzzer + Sad Brass
   */
  public playWrong() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Dissonant slide
    [261.63, 246.94].forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.6);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(now);
      osc.stop(now + 0.65);
    });
  }

  /**
   * Authentic Crowd Cheering FX
   */
  public playCrowdCheer(duration = 1.2) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Noise buffer for applause/cheer
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    // Bandpass filter to shape noise into cheering crowd acoustics
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.Q.setValueAtTime(1.5, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.getDestination());

    whiteNoise.start(now);
    whiteNoise.stop(now + duration + 0.05);
  }

  /**
   * Cash Register Ding
   */
  public playCashDing() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2093, now); // C7
    osc.frequency.setValueAtTime(3135.96, now + 0.08); // G7

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(gain);
    gain.connect(this.getDestination());

    osc.start(now);
    osc.stop(now + 0.75);
  }

  /**
   * Dramatic Orchestra Hit / Suspense Stab (for Screws)
   */
  public playScrewStab() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Authentic 80s Fairlight Orchestra Hit simulation
    const chord = [130.81, 196.00, 246.94, 329.63, 440.00];
    chord.forEach((freq) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(now);
      osc.stop(now + 0.9);
    });
  }

  public playCountdownTick() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.getDestination());

    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playFanfare() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const fanfare = [
      { f: 523.25, d: 0.14 },
      { f: 523.25, d: 0.14 },
      { f: 659.25, d: 0.2 },
      { f: 783.99, d: 0.2 },
      { f: 1046.50, d: 0.6 }
    ];

    let t = now;
    fanfare.forEach(item => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(item.f, t);

      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + item.d);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(t);
      osc.stop(t + item.d + 0.05);

      t += item.d + 0.04;
    });
  }

  // --- Authentic Master Song Clips (Actual Songs) ---
  private currentSongAudio: HTMLAudioElement | null = null;
  private songMediaNode: MediaElementAudioSourceNode | null = null;

  public stopCurrentClip() {
    if (this.currentSongAudio) {
      try {
        this.currentSongAudio.pause();
        this.currentSongAudio.currentTime = 0;
      } catch {}
      this.currentSongAudio = null;
    }
    if (this.currentClipStopFn) {
      this.currentClipStopFn();
      this.currentClipStopFn = null;
    }
  }

  /**
   * Plays the actual, real audio clip from the authentic 80s song master recording
   */
  public playSongClip(songKey: string, onEnd?: () => void) {
    this.stopCurrentClip();
    if (this.isMuted) {
      if (onEnd) onEnd();
      return;
    }
    this.init();

    try {
      const audio = new Audio(`/api/song-clip/${encodeURIComponent(songKey)}`);
      audio.crossOrigin = 'anonymous';
      this.currentSongAudio = audio;

      // Connect to analyser for neon spectrum visualization
      if (this.ctx) {
        try {
          const source = this.ctx.createMediaElementSource(audio);
          source.connect(this.getDestination());
        } catch {
          // If already connected or cross-origin fallback, direct play still functions
        }
      }

      // 12-second clip limit for trivia pacing
      const clipTimeout = window.setTimeout(() => {
        this.stopCurrentClip();
        if (onEnd) onEnd();
      }, 12000);

      audio.onended = () => {
        clearTimeout(clipTimeout);
        this.currentSongAudio = null;
        if (onEnd) onEnd();
      };

      audio.onerror = (err) => {
        clearTimeout(clipTimeout);
        console.warn('Song clip playback error:', err);
        this.currentSongAudio = null;
        if (onEnd) onEnd();
      };

      this.currentClipStopFn = () => {
        clearTimeout(clipTimeout);
        if (this.currentSongAudio) {
          try {
            this.currentSongAudio.pause();
          } catch {}
          this.currentSongAudio = null;
        }
      };

      audio.play().catch((err) => {
        console.warn('Audio play prevented by browser:', err);
        clearTimeout(clipTimeout);
        if (onEnd) onEnd();
      });
    } catch (err) {
      console.error('Failed to initiate song clip:', err);
      if (onEnd) onEnd();
    }
  }

  public toggleBgm(enable?: boolean) {
    const target = enable !== undefined ? enable : !this.isBgmPlaying;
    if (target === this.isBgmPlaying) return;

    if (!target) {
      this.isBgmPlaying = false;
      if (this.bgmInterval) {
        clearInterval(this.bgmInterval);
        this.bgmInterval = null;
      }
      return;
    }

    this.init();
    if (!this.ctx) return;
    this.isBgmPlaying = true;

    const bassNotes = [130.81, 130.81, 155.56, 174.61, 130.81, 130.81, 196.00, 185.00];
    let step = 0;

    this.bgmInterval = window.setInterval(() => {
      if (this.isMuted || !this.isBgmPlaying || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(bassNotes[step % bassNotes.length], now);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.getDestination());

      osc.start(now);
      osc.stop(now + 0.25);

      step++;
    }, 250);
  }

  public getBgmStatus(): boolean {
    return this.isBgmPlaying;
  }
}

export const synth = new StudioAudioEngine();
