/* Own-microphone PCM only. No recording, network access or persistent buffers. */
class SpectrumCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.frame = new Float32Array(320);
		this.offset = 0;
		this.ratio = sampleRate / 16000;
		this.remaining = this.ratio;
		this.sum = 0;
	}
	process(inputs) {
		const input = inputs[0]?.[0];
		if (input) for (const sample of input) {
			let width = 1;
			while (width > 1e-8) {
				const used = Math.min(width, this.remaining);
				this.sum += sample * used;
				width -= used;
				this.remaining -= used;
				if (this.remaining < 1e-8) {
					this.frame[this.offset++] = this.sum / this.ratio;
					this.sum = 0;
					this.remaining = this.ratio;
					if (this.offset === 320) {
						this.port.postMessage(this.frame, [this.frame.buffer]);
						this.frame = new Float32Array(320);
						this.offset = 0;
					}
				}
			}
		}
		return true;
	}
}
registerProcessor('spectrum-capture', SpectrumCapture);
