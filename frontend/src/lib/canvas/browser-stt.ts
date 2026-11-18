import { BrowserSTTSegmenter, type BrowserAudioChunk } from './browser-stt-segmenter';
import type { STTLoadProgress } from './browser-stt-load';
export type { STTLoadProgress } from './browser-stt-load';

export type BrowserSTTModel = 'base' | 'parakeet';
export type BrowserSTTBackend = 'wasm' | 'webgpu';
export type BrowserSTTFailureReason = 'failed' | 'slow' | 'gpu' | 'download' | 'assets' | 'engine';

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

/** Confirmed hardware only; Whisper FP16 requires an additional feature gate. */
export async function browserSTTWebGPUAvailable(requireFP16 = true): Promise<boolean> {
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
			adapter &&
			adapter.info?.isFallbackAdapter === false &&
			(!requireFP16 || adapter.features.has('shader-f16'))
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
	private loadDeadline: ReturnType<typeof setTimeout> | undefined;
	private loading = false;
	private inFlight = false;
	private captureEpoch = 0;
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
			failure: (reason: BrowserSTTFailureReason) => void;
			progress?: (value: STTLoadProgress) => void;
		},
		private model: BrowserSTTModel = 'base',
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
		this.worker.onerror = () => this.fail(this.loading ? 'engine' : 'failed');
		this.worker.onmessage = ({ data }) => {
			if (this.disposed) return;
			if (data.type === 'ready') {
				clearTimeout(this.timer);
				clearTimeout(this.loadDeadline);
				this.loading = false;
				if (data.backend !== this.backend) {
					this.fail(this.backend === 'webgpu' ? 'gpu' : 'failed');
					return;
				}
				this.callbacks.ready();
			} else if (data.type === 'progress' && this.loading) {
				const progress = data.progress as STTLoadProgress | undefined;
				if (
					!progress ||
					!['download', 'initializing', 'cache'].includes(progress.phase) ||
					!Number.isFinite(progress.loaded) ||
					!Number.isFinite(progress.total) ||
					progress.loaded < 0 ||
					progress.total < progress.loaded
				)
					return;
				clearTimeout(this.timer);
				const downloading = progress.phase === 'download';
				this.timer = setTimeout(
					() => this.fail(downloading ? 'download' : 'engine'),
					downloading ? 90000 : 180000
				);
				this.callbacks.progress?.(progress);
			} else if (data.type === 'error')
				this.fail(
					['failed', 'slow', 'gpu', 'download', 'assets', 'engine'].includes(data.reason)
						? (data.reason as BrowserSTTFailureReason)
						: 'failed'
				);
			else if (data.type === 'result' && data.id === this.job && this.inFlight) {
				clearTimeout(this.timer);
				this.inFlight = false;
				const current = this.current;
				this.current = null;
				if (data.text && current)
					this.callbacks.segment({
						text: data.text,
						language: data.language,
						sequence: ++this.sequence,
						start: current.start,
						end: current.end
					});
				if (this.pending) {
					const next = this.pending;
					this.pending = null;
					this.infer(next);
				}
			}
		};
		this.loading = true;
		// A progressing cold model download may legitimately take many minutes.
		// Bound inactivity separately from initialization and the total startup.
		this.timer = setTimeout(() => this.fail('download'), 90000);
		this.loadDeadline = setTimeout(() => this.fail('download'), 30 * 60000);
		this.worker.postMessage({ type: 'load', model: this.model, backend: this.backend });
	}
	async captureTrack(track: MediaStreamTrack, isCurrent: () => boolean = () => true) {
		this.pauseCapture();
		const epoch = this.captureEpoch;
		try {
			const context = this.context;
			if (!context) return;
			if (context.sampleRate < 16000 || context.sampleRate > 96000)
				throw new Error('Unsupported sample rate');
			await context.resume();
			if (this.disposed || epoch !== this.captureEpoch || !isCurrent()) return;
			await context.audioWorklet.addModule('/stt-capture.js');
			if (this.disposed || epoch !== this.captureEpoch || !isCurrent()) return;
			this.source = context.createMediaStreamSource(new MediaStream([track]));
			this.capture = new AudioWorkletNode(context, 'spectrum-capture');
			this.gain = context.createGain();
			this.gain.gain.value = 0;
			this.capture.port.onmessage = ({ data }) => {
				if (this.disposed || epoch !== this.captureEpoch || !isCurrent()) return;
				const chunk = this.segmenter.push(data);
				if (!chunk) return;
				if (!this.inFlight) this.infer(chunk);
				else if (!this.pending) this.pending = chunk;
				else this.fail('slow'); // Stop instead of accumulating or silently losing speech.
			};
			this.source.connect(this.capture);
			this.capture.connect(this.gain).connect(context.destination);
		} catch {
			if (!this.disposed && epoch === this.captureEpoch && isCurrent()) this.fail('failed');
		}
	}
	/** Detach only local ASR capture. Keep public model preparation/runtime alive. */
	pauseCapture() {
		this.captureEpoch++;
		this.source?.disconnect();
		this.capture?.disconnect();
		this.gain?.disconnect();
		if (this.capture) {
			this.capture.port.onmessage = null;
			this.capture.port.close();
		}
		this.source = null;
		this.capture = null;
		this.gain = null;
		this.current = this.pending = null;
		this.segmenter = new BrowserSTTSegmenter();
		this.sequence = 0;
		// An already running bounded job must finish/discard before a new one.
		// Never clear download watchdogs when no microphone exists.
		if (!this.loading && !this.inFlight) clearTimeout(this.timer);
	}
	private infer(chunk: BrowserAudioChunk) {
		if (this.disposed || !this.worker) return;
		this.current = chunk;
		this.inFlight = true;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.fail('slow'), 20000);
		this.worker.postMessage(
			{ type: 'recognize', id: ++this.job, language: this.language, audio: chunk.audio.buffer },
			[chunk.audio.buffer]
		);
	}
	private fail(reason: BrowserSTTFailureReason) {
		if (this.disposed) return;
		this.stop();
		this.callbacks.failure(reason);
	}
	stop() {
		this.disposed = true;
		clearTimeout(this.timer);
		clearTimeout(this.loadDeadline);
		this.loading = false;
		this.worker?.terminate();
		this.worker = null;
		this.pauseCapture();
		if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
		this.inFlight = false;
		this.context = null;
		this.current = this.pending = null;
		this.segmenter = new BrowserSTTSegmenter();
	}
}
