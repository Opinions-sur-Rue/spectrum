export interface BrowserAudioChunk {
	audio: Float32Array;
	start: number;
	end: number;
}

/** Bounded energy-gated baseline, not a neural VAD. One 20 ms frame per push. */
export class BrowserSTTSegmenter {
	private frames: Float32Array[] = [];
	private preroll: Float32Array[] = [];
	private position = 0;
	private start = 0;
	private speech = 0;
	private silence = 0;
	push(frame: Float32Array): BrowserAudioChunk | null {
		if (frame.length !== 320) return null;
		this.position += 20;
		const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
		const voiced = Number.isFinite(rms) && rms >= 0.008;
		if (!this.frames.length && !voiced) {
			this.preroll.push(frame);
			if (this.preroll.length > 10) this.preroll.shift();
			return null;
		}
		if (!this.frames.length) {
			this.start = this.position - 20 * (this.preroll.length + 1);
			this.frames = this.preroll;
			this.preroll = [];
		}
		this.frames.push(frame);
		this.speech += voiced ? 20 : 0;
		this.silence = voiced ? 0 : this.silence + 20;
		if (this.frames.length < 400 && this.silence < 800) return null;
		let result: BrowserAudioChunk | null = null;
		if (this.speech >= 200) {
			const audio = new Float32Array(this.frames.length * 320);
			this.frames.forEach((value, index) => audio.set(value, index * 320));
			result = { audio, start: this.start, end: this.position };
		}
		this.frames = [];
		this.speech = this.silence = 0;
		return result;
	}
}
