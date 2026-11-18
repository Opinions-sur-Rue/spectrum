import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserSTT, browserSTTWebGPUAvailable } from './browser-stt';

class FakeWorker {
	static last: FakeWorker;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();
	constructor() {
		FakeWorker.last = this;
	}
	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data });
	}
}
class FakeCapture {
	static last: FakeCapture;
	port = { onmessage: null as ((event: { data: Float32Array }) => void) | null, close: vi.fn() };
	connect = vi.fn((value) => value);
	disconnect = vi.fn();
	constructor() {
		FakeCapture.last = this;
	}
}
class FakeContext {
	static last: FakeContext;
	constructor() {
		FakeContext.last = this;
	}
	sampleRate = 48000;
	state = 'running';
	audioWorklet = { addModule: vi.fn(async () => {}) };
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {
		this.state = 'closed';
	});
	createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
	createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }));
	destination = {};
}
let engine: BrowserSTT;
const callbacks = { ready: vi.fn(), segment: vi.fn(), failure: vi.fn(), progress: vi.fn() };
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	vi.stubGlobal('Worker', FakeWorker);
	vi.stubGlobal('AudioContext', FakeContext);
	vi.stubGlobal('AudioWorkletNode', FakeCapture);
	vi.stubGlobal('MediaStream', class {});
	engine = new BrowserSTT('fr', callbacks);
});
afterEach(() => {
	engine.stop();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('starts no worker or microphone before explicit load; stopping fences late model readiness', () => {
	expect(callbacks.ready).not.toHaveBeenCalled();
	engine.load();
	const worker = FakeWorker.last;
	expect(worker.postMessage).toHaveBeenCalledWith({ type: 'load', model: 'base', backend: 'wasm' });
	engine.stop();
	worker.emit({ type: 'ready', backend: 'wasm' });
	expect(worker.terminate).toHaveBeenCalledOnce();
	expect(callbacks.ready).not.toHaveBeenCalled();
});

it('bounds pending audio and stops without stopping the voice track on overload', async () => {
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	engine.load();
	FakeWorker.last.emit({ type: 'ready', backend: 'wasm' });
	await engine.captureTrack(track);
	for (let i = 0; i < 1200; i++)
		FakeCapture.last.port.onmessage?.({ data: new Float32Array(320).fill(0.1) });
	expect(callbacks.failure).toHaveBeenCalledWith('slow');
	expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
	expect(track.stop).not.toHaveBeenCalled();
	FakeWorker.last.emit({ type: 'result', id: 1, text: 'late private words', language: 'fr' });
	expect(callbacks.segment).not.toHaveBeenCalled();
});

it('emits ordered final text with capture-relative timestamps, never audio', async () => {
	engine.load();
	FakeWorker.last.emit({ type: 'ready', backend: 'wasm' });
	await engine.captureTrack({} as MediaStreamTrack);
	for (let i = 0; i < 400; i++)
		FakeCapture.last.port.onmessage?.({ data: new Float32Array(320).fill(0.1) });
	FakeWorker.last.emit({ type: 'result', id: 1, text: 'Bonjour', language: 'fr' });
	expect(callbacks.segment).toHaveBeenCalledWith({
		text: 'Bonjour',
		language: 'fr',
		sequence: 1,
		start: 0,
		end: 8000
	});
	expect(callbacks.segment.mock.lastCall?.[0]).not.toHaveProperty('audio');
});

it('times out stalled downloads rather than blocking voice indefinitely', () => {
	engine.load();
	vi.advanceTimersByTime(90000);
	expect(callbacks.failure).toHaveBeenCalledWith('download');
	expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
});

it('pausing microphone-free preparation preserves worker and download watchdog', () => {
	engine.load();
	engine.pauseCapture();
	expect(FakeContext.last.createMediaStreamSource).not.toHaveBeenCalled();
	expect(FakeWorker.last.terminate).not.toHaveBeenCalled();
	vi.advanceTimersByTime(90000);
	expect(callbacks.failure).toHaveBeenCalledWith('download');
});

it('discards paused inference and serializes capture resumed with the loaded worker', async () => {
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	engine.load();
	const worker = FakeWorker.last;
	worker.emit({ type: 'ready', backend: 'wasm' });
	await engine.captureTrack(track);
	for (let i = 0; i < 400; i++)
		FakeCapture.last.port.onmessage?.({ data: new Float32Array(320).fill(0.1) });
	expect(worker.postMessage.mock.calls.filter(([job]) => job.type === 'recognize')).toHaveLength(1);
	const oldCapture = FakeCapture.last;
	engine.pauseCapture();
	expect(oldCapture.port.close).toHaveBeenCalledOnce();
	expect(track.stop).not.toHaveBeenCalled();
	expect(worker.terminate).not.toHaveBeenCalled();
	await engine.captureTrack(track);
	for (let i = 0; i < 400; i++)
		FakeCapture.last.port.onmessage?.({ data: new Float32Array(320).fill(0.1) });
	expect(worker.postMessage.mock.calls.filter(([job]) => job.type === 'recognize')).toHaveLength(1);
	worker.emit({ type: 'result', id: 1, text: 'private old words', language: 'fr' });
	expect(callbacks.segment).not.toHaveBeenCalled();
	expect(worker.postMessage.mock.calls.filter(([job]) => job.type === 'recognize')).toHaveLength(2);
	worker.emit({ type: 'result', id: 2, text: 'new words', language: 'fr' });
	expect(callbacks.segment).toHaveBeenCalledWith(
		expect.objectContaining({ text: 'new words', sequence: 1 })
	);
});

it.each([false, true])(
	'cancels delayed worklet attachment and ignores stale rejection=%s',
	async (reject) => {
		engine.load();
		let resolve!: () => void;
		let fail!: (reason: Error) => void;
		FakeContext.last.audioWorklet.addModule.mockImplementationOnce(
			() =>
				new Promise<void>((yes, no) => {
					resolve = yes;
					fail = no;
				})
		);
		const attaching = engine.captureTrack({} as MediaStreamTrack);
		await Promise.resolve();
		engine.pauseCapture();
		if (reject) fail(new Error('stale worklet'));
		else resolve();
		await attaching;
		expect(FakeContext.last.createMediaStreamSource).not.toHaveBeenCalled();
		expect(callbacks.failure).not.toHaveBeenCalled();
		expect(FakeWorker.last.terminate).not.toHaveBeenCalled();
	}
);

it('checks live admission context before delayed capture attaches, without waiting for cleanup', async () => {
	engine.load();
	let resolve!: () => void;
	let current = true;
	FakeContext.last.audioWorklet.addModule.mockImplementationOnce(
		() =>
			new Promise<void>((done) => {
				resolve = done;
			})
	);
	const attaching = engine.captureTrack({} as MediaStreamTrack, () => current);
	await Promise.resolve();
	resolve();
	current = false; // Prop/session invalidation precedes reactive effect cleanup.
	await attaching;
	expect(FakeContext.last.createMediaStreamSource).not.toHaveBeenCalled();
	expect(callbacks.failure).not.toHaveBeenCalled();
});

it('keeps progressing downloads alive beyond two minutes, then stops on inactivity', () => {
	engine.load();
	for (let loaded = 1; loaded <= 3; loaded++) {
		vi.advanceTimersByTime(60000);
		FakeWorker.last.emit({
			type: 'progress',
			progress: { phase: 'download', asset: 'encoder', loaded, total: 100 }
		});
	}
	expect(callbacks.failure).not.toHaveBeenCalled();
	expect(callbacks.progress).toHaveBeenCalledTimes(3);
	vi.advanceTimersByTime(90000);
	expect(callbacks.failure).toHaveBeenCalledWith('download');
});

it('bounds initialization separately and retains a hard total download deadline', () => {
	engine.load();
	FakeWorker.last.emit({
		type: 'progress',
		progress: { phase: 'initializing', asset: 'encoder', loaded: 100, total: 100 }
	});
	vi.advanceTimersByTime(179999);
	expect(callbacks.failure).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(callbacks.failure).toHaveBeenCalledWith('engine');
	engine = new BrowserSTT('fr', callbacks);
	callbacks.failure.mockClear();
	engine.load();
	for (let minute = 1; minute < 30; minute++) {
		vi.advanceTimersByTime(60000);
		FakeWorker.last.emit({
			type: 'progress',
			progress: { phase: 'download', asset: 'encoder', loaded: minute, total: 100 }
		});
	}
	vi.advanceTimersByTime(60000);
	expect(callbacks.failure).toHaveBeenCalledWith('download');
});

it('ignores late progress after readiness and reports distinct asset failures', () => {
	engine.load();
	FakeWorker.last.emit({ type: 'ready', backend: 'wasm' });
	FakeWorker.last.emit({
		type: 'progress',
		progress: { phase: 'download', asset: 'encoder', loaded: 1, total: 100 }
	});
	vi.advanceTimersByTime(180000);
	expect(callbacks.failure).not.toHaveBeenCalled();
	expect(callbacks.progress).not.toHaveBeenCalled();
	FakeWorker.last.emit({ type: 'error', reason: 'assets' });
	expect(callbacks.failure).toHaveBeenCalledWith('assets');
});

it('loads base only when explicitly selected', () => {
	engine = new BrowserSTT('fr', callbacks, 'base');
	engine.load();
	expect(FakeWorker.last.postMessage).toHaveBeenCalledWith({
		type: 'load',
		model: 'base',
		backend: 'wasm'
	});
});

it('loads GPU only when explicitly selected and reports GPU failure distinctly', () => {
	engine = new BrowserSTT('fr', callbacks, 'base', 'webgpu');
	engine.load();
	expect(FakeWorker.last.postMessage).toHaveBeenCalledWith({
		type: 'load',
		model: 'base',
		backend: 'webgpu'
	});
	FakeWorker.last.emit({ type: 'error', reason: 'gpu' });
	expect(callbacks.failure).toHaveBeenCalledWith('gpu');
});

it('offers WebGPU only for hardware adapters with FP16, never a software fallback', async () => {
	vi.stubGlobal('navigator', {
		gpu: {
			requestAdapter: async () => ({
				info: { isFallbackAdapter: false },
				features: { has: (name: string) => name === 'shader-f16' }
			})
		}
	});
	await expect(browserSTTWebGPUAvailable()).resolves.toBe(true);
	vi.stubGlobal('navigator', {
		gpu: {
			requestAdapter: async () => ({
				info: { isFallbackAdapter: true },
				features: { has: () => true }
			})
		}
	});
	await expect(browserSTTWebGPUAvailable()).resolves.toBe(false);
	vi.stubGlobal('navigator', {
		gpu: { requestAdapter: async () => null }
	});
	await expect(browserSTTWebGPUAvailable()).resolves.toBe(false);
});

it('rejects a silent GPU-to-CPU backend mismatch', () => {
	engine = new BrowserSTT('fr', callbacks, 'base', 'webgpu');
	engine.load();
	FakeWorker.last.emit({ type: 'ready', backend: 'wasm' });
	expect(callbacks.ready).not.toHaveBeenCalled();
	expect(callbacks.failure).toHaveBeenCalledWith('gpu');
});

it('permits confirmed Parakeet hardware without FP16 but rejects unknown hardware identity', async () => {
	vi.stubGlobal('navigator', {
		gpu: {
			requestAdapter: async () => ({
				info: { isFallbackAdapter: false },
				features: { has: () => false }
			})
		}
	});
	await expect(browserSTTWebGPUAvailable(false)).resolves.toBe(true);
	await expect(browserSTTWebGPUAvailable()).resolves.toBe(false);
	vi.stubGlobal('navigator', {
		gpu: { requestAdapter: async () => ({ info: {}, features: { has: () => true } }) }
	});
	await expect(browserSTTWebGPUAvailable(false)).resolves.toBe(false);
});

it('closes local processing if browser refuses to construct the worker', () => {
	vi.stubGlobal(
		'Worker',
		class {
			constructor() {
				throw new Error('Worker blocked');
			}
		}
	);
	expect(() => engine.load()).not.toThrow();
	expect(callbacks.failure).toHaveBeenCalledWith('failed');
});
