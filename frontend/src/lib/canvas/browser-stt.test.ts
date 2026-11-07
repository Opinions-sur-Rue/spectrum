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
const callbacks = { ready: vi.fn(), segment: vi.fn(), failure: vi.fn() };
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
	expect(worker.postMessage).toHaveBeenCalledWith({ type: 'load', model: 'tiny', backend: 'wasm' });
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

it('times out model startup rather than blocking voice indefinitely', () => {
	engine.load();
	vi.advanceTimersByTime(120000);
	expect(callbacks.failure).toHaveBeenCalledWith('failed');
	expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
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
	engine = new BrowserSTT('fr', callbacks, 'tiny', 'webgpu');
	engine.load();
	expect(FakeWorker.last.postMessage).toHaveBeenCalledWith({
		type: 'load',
		model: 'tiny',
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
	engine = new BrowserSTT('fr', callbacks, 'tiny', 'webgpu');
	engine.load();
	FakeWorker.last.emit({ type: 'ready', backend: 'wasm' });
	expect(callbacks.ready).not.toHaveBeenCalled();
	expect(callbacks.failure).toHaveBeenCalledWith('gpu');
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
