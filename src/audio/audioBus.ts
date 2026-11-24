/**
 * One shared output AudioContext with named gain buses so every sound source
 * (host voice, clips, sound effects) can be mixed, muted, and ducked together.
 */
export type BusName = 'voice' | 'clip' | 'sfx';

class AudioBus {
  private context: AudioContext | null = null;
  private buses = new Map<BusName, GainNode>();
  private master: GainNode | null = null;
  private gains: Record<BusName, number> = { voice: 1, clip: 1, sfx: 0.9 };
  private muted = false;

  get available() {
    return typeof window !== 'undefined' && typeof AudioContext !== 'undefined';
  }

  getContext(): AudioContext | null {
    if (!this.available) return null;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.context.destination);
      for (const name of ['voice', 'clip', 'sfx'] as BusName[]) {
        const gain = this.context.createGain();
        gain.gain.value = this.gains[name];
        gain.connect(this.master);
        this.buses.set(name, gain);
      }
    }
    return this.context;
  }

  bus(name: BusName): GainNode | null {
    this.getContext();
    return this.buses.get(name) ?? null;
  }

  async resume() {
    const context = this.getContext();
    if (context && context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('Audio output could not resume:', error);
      }
    }
    return context;
  }

  setGain(name: BusName, value: number) {
    this.gains[name] = value;
    const bus = this.buses.get(name);
    if (bus && this.context) bus.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }

  getGain(name: BusName) {
    return this.gains[name];
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.01);
  }

  isMuted() {
    return this.muted;
  }

  /** Decodes base64 PCM16 (little endian) into an AudioBuffer. */
  pcm16ToBuffer(base64: string, sampleRate: number): AudioBuffer | null {
    const context = this.getContext();
    if (!context) return null;
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const buffer = context.createBuffer(1, Math.max(1, sampleCount), sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index++) channel[index] = view.getInt16(index * 2, true) / 32768;
    return buffer;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    const context = this.getContext();
    if (!context) return null;
    return context.decodeAudioData(data.slice(0));
  }
}

export const audioBus = new AudioBus();
