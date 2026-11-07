import { BrowserSTTSegmenter, type BrowserAudioChunk } from './browser-stt-segmenter';

export type BrowserSTTModel = 'tiny' | 'base' | 'small';
export type BrowserSTTBackend = 'wasm' | 'webgpu';

export interface BrowserTranscriptSession {
	roomId: string;
	requestId: string;
	sessionId: string;
	generation: number;
}
export interface BrowserTranscriptFailure {
	requestId?: string;
	message: string;
}

export function browserSTTSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		typeof Worker !== 'undefined' &&
		typeof WebAssembly !== 'undefined' &&
		typeof AudioContext !== 'undefined' &&
		typeof AudioWorkletNode !== 'undefined'
	);
}

/** Hardware WebGPU with FP16 only; never selects a software fallback adapter. */
export async function browserSTTWebGPUAvailable(): Promise<boolean> {
	if (typeof navigator === 'undefined') return false;
	const gpu = (
		navigator as Navigator & {
			gpu?: {
				requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<{
					info?: { isFallbackAdapter?: boolean };
					features: { has(name: string): boolean };
				} | null>;
			};
		}
	).gpu;
	if (!gpu) return false;
	try {
		const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
		return Boolean(
			adapter && !adapter.info?.isFallbackAdapter && adapter.features.has('shader-f16')
		);
	} catch {
		return false;
	}
}

/** Own published microphone only; lifecycle is independent from voice publication. */
export class BrowserSTT {
	private worker: Worker | null = null;
	private context: AudioContext | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private capture: AudioWorkletNode | null = null;
	private gain: GainNode | null = null;
	private segmenter = new BrowserSTTSegmenter();
	private pending: BrowserAudioChunk | null = null;
	private current: BrowserAudioChunk | null = null;
	private sequence = 0;
	private job = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	constructor(
		private language: 'fr' | 'en' | 'auto',
		private callbacks: {
			ready: () => void;
			segment: (value: {
				text: string;
				language: string;
				sequence: number;
				start: number;
				end: number;
			}) => void;
			failure: (reason: 'failed' | 'slow' | 'gpu') => void;
		},
		private model: BrowserSTTModel = 'tiny',
		private backend: BrowserSTTBackend = 'wasm'
	) {}
	load() {
		try {
			this.context = new AudioContext();
			void this.context.resume().catch(() => this.fail('failed'));
		} catch {
			this.fail('failed');
			return;
		}
		try {
			this.worker = new Worker(new URL('./browser-stt-worker.ts', import.meta.url), {
				type: 'module'
			});
		} catch {
			this.fail('failed');
			return;
		}
		this.worker.onerror = () => this.fail('failed');
		this.worker.onmessage = ({ data }) => {
			if (this.disposed) return;
			if (data.type === 'ready') {
				clearTimeout(this.timer);
				if (data.backend !== this.backend) {
					this.fail(this.backend === 'webgpu' ? 'gpu' : 'failed');
					return;
				}
				this.callbacks.ready();
			} else if (data.type === 'error') this.fail(data.reason === 'gpu' ? 'gpu' : 'failed');
			else if (data.type === 'result' && data.id === this.job && this.current) {
				clearTimeout(this.timer);
				const { start, end } = this.current;
				this.current = null;
				if (data.text)
					this.callbacks.segment({
						text: data.text,
						language: data.language,
						sequence: ++this.sequence,
						start,
						end
					});
				if (this.pending) {
					const next = this.pending;
					this.pending = null;
					this.infer(next);
				}
			}
		};
		this.timer = setTimeout(() => this.fail('failed'), 120000);
		this.worker.postMessage({ type: 'load', model: this.model, backend: this.backend });
	}
	async captureTrack(track: MediaStreamTrack) {
		try {
			const context = this.context;
			if (!context) return;
			if (context.sampleRate < 16000 || context.sampleRate > 96000)
				throw new Error('Unsupported sample rate');
			await context.resume();
			await context.audioWorklet.addModule('/stt-capture.js');
			if (this.disposed) {
				await context.close();
				return;
			}
			this.source = context.createMediaStreamSource(new MediaStream([track]));
			this.capture = new AudioWorkletNode(context, 'spectrum-capture');
			this.gain = context.createGain();
			this.gain.gain.value = 0;
			this.capture.port.onmessage = ({ data }) => {
				if (this.disposed) return;
				const chunk = this.segmenter.push(data);
				if (!chunk) return;
				if (!this.current) this.infer(chunk);
				else if (!this.pending) this.pending = chunk;
				else this.fail('slow'); // Stop instead of accumulating or silently losing speech.
			};
			this.source.connect(this.capture);
			this.capture.connect(this.gain).connect(context.destination);
		} catch {
			if (!this.disposed) this.fail('failed');
		}
	}
	private infer(chunk: BrowserAudioChunk) {
		if (this.disposed || !this.worker) return;
		this.current = chunk;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.fail('slow'), 20000);
		this.worker.postMessage(
			{ type: 'recognize', id: ++this.job, language: this.language, audio: chunk.audio.buffer },
			[chunk.audio.buffer]
		);
	}
	private fail(reason: 'failed' | 'slow' | 'gpu') {
		if (this.disposed) return;
		this.stop();
		this.callbacks.failure(reason);
	}
	stop() {
		this.disposed = true;
		clearTimeout(this.timer);
		this.worker?.terminate();
		this.worker = null;
		this.source?.disconnect();
		this.capture?.disconnect();
		this.gain?.disconnect();
		if (this.capture) {
			this.capture.port.onmessage = null;
			this.capture.port.close();
		}
		if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
		this.source = null;
		this.capture = null;
		this.gain = null;
		this.context = null;
		this.current = this.pending = null;
		this.segmenter = new BrowserSTTSegmenter();
	}
}
