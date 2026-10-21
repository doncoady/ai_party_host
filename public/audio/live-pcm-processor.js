class LivePcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(2048);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index++) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.chunk[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === this.chunk.length) {
        const completed = this.chunk;
        this.port.postMessage(completed.buffer, [completed.buffer]);
        this.chunk = new Int16Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('live-pcm-capture', LivePcmCaptureProcessor);
