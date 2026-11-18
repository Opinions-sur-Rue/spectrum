import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
	load: vi.fn(),
	read: vi.fn(),
	create: vi.fn(),
	initialize: vi.fn(),
	recognize: vi.fn(),
	release: vi.fn(),
	processor: vi.fn(),
	tokenizer: vi.fn(),
	baseModel: vi.fn(),
	deviceLost: null as null | (() => void),
	wasm: {} as Record<string, unknown>,
	ortEnv: { wasm: {}, webgpu: {} } as {
		wasm: Record<string, unknown>;
		webgpu: Record<string, unknown>;
	}
}));
vi.mock('@huggingface/transformers', () => ({
	env: { backends: { onnx: { wasm: fixture.wasm } } },
	AutoProcessor: { from_pretrained: fixture.processor },
	AutoTokenizer: { from_pretrained: fixture.tokenizer },
	Tensor: class {},
	WhisperForConditionalGeneration: { from_pretrained: fixture.baseModel }
}));
vi.mock('onnxruntime-web/webgpu', () => ({
	env: fixture.ortEnv,
	InferenceSession: { create: fixture.create }
}));
vi.mock('./parakeet-runtime', () => ({ ParakeetRuntime: { load: fixture.load } }));
vi.mock('./browser-stt-vad', () => ({
	browserSpeechBounds: vi.fn(async () => ({ start: 0, end: 16000 }))
}));
vi.mock('./browser-stt-load', () => ({
	STTAssetLoader: class {
		constructor(assets: unknown) {
			fixture.initialize(assets);
		}
		read = fixture.read;
		initializing = vi.fn();
	},
	STTLoadError: class extends Error {
		constructor(public reason: string) {
			super(reason);
		}
	}
}));

function adapter(fallback: boolean | undefined = false, fp16 = false) {
	return { info: { isFallbackAdapter: fallback }, features: { has: (): boolean => fp16 } };
}

async function worker(gpuAdapter: ReturnType<typeof adapter> | null) {
	const scope = {
		navigator: { gpu: { requestAdapter: vi.fn(async () => gpuAdapter) } },
		location: { origin: 'http://localhost' },
		postMessage: vi.fn(),
		onmessage: null as unknown as (event: { data: Record<string, unknown> }) => Promise<void>
	};
	vi.stubGlobal('self', scope);
	await import('./browser-stt-worker');
	return scope;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	fixture.load
		.mockReset()
		.mockResolvedValue({ recognize: fixture.recognize, release: fixture.release });
	fixture.release.mockResolvedValue(undefined);
	fixture.recognize.mockReset().mockResolvedValue('fixture');
	fixture.read.mockResolvedValue(new Uint8Array([1]));
	fixture.create.mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
	fixture.ortEnv.webgpu = {};
	fixture.ortEnv.webgpu.device = Promise.resolve({
		lost: new Promise<void>((resolve) => {
			fixture.deviceLost = resolve;
		})
	});
	fixture.ortEnv.wasm = {};
	fixture.processor.mockReset().mockResolvedValue({});
	fixture.tokenizer.mockReset().mockResolvedValue({});
	fixture.baseModel.mockReset().mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());

describe('Parakeet worker GPU selection', () => {
	it('reports actual device loss before another inference and releases nested helper', async () => {
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		fixture.deviceLost!();
		await Promise.resolve();
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason: 'gpu' });
	});
	it('does not report stale GPU device loss after switching to CPU', async () => {
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'wasm' } });
		fixture.deviceLost!();
		await Promise.resolve();
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'ready', backend: 'wasm' });
	});
	it('does not confuse a documentation URL inside GPU inference failure with download failure', async () => {
		fixture.recognize.mockRejectedValue(
			new Error('GPUDevice destroyed. See https://example.test/webgpu')
		);
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		await scope.onmessage({
			data: { type: 'recognize', language: 'fr', id: 1, audio: new Float32Array(16000).buffer }
		});
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason: 'gpu' });
	});
	it('loads only Base FP16 on GPU and q8 only when a new CPU load is explicitly requested', async () => {
		const scope = await worker(adapter(false, true));
		await scope.onmessage({ data: { type: 'load', model: 'base', backend: 'webgpu' } });
		expect(fixture.baseModel).toHaveBeenCalledOnce();
		expect(fixture.baseModel).toHaveBeenLastCalledWith(
			'/stt/models/whisper-base',
			expect.objectContaining({ device: 'webgpu', dtype: 'fp16' })
		);
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready', backend: 'webgpu' });
		await scope.onmessage({ data: { type: 'load', model: 'base', backend: 'wasm' } });
		expect(fixture.baseModel).toHaveBeenCalledTimes(2);
		expect(fixture.baseModel).toHaveBeenLastCalledWith(
			'/stt/models/whisper-base',
			expect.objectContaining({ device: 'wasm', dtype: 'q8' })
		);
	});

	it.each([
		['Could not locate file /stt/base_fp16.onnx', 'assets'],
		['Failed to fetch', 'download']
	])('does not misclassify Base loader failure %s as GPU', async (message, reason) => {
		fixture.baseModel.mockRejectedValueOnce(new Error(message));
		const scope = await worker(adapter(false, true));
		await scope.onmessage({ data: { type: 'load', model: 'base', backend: 'webgpu' } });
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason });
		expect(fixture.baseModel).toHaveBeenCalledOnce();
	});
	it.each([
		['Could not locate file /stt/model.onnx', 'assets'],
		['Missing model asset', 'assets'],
		['integrity checksum mismatch', 'assets'],
		['Failed to fetch WebGPU model', 'download'],
		['Network download failed', 'download'],
		['Consent denied', 'failed']
	])('preserves non-typed loader error %s as %s instead of GPU', async (message, reason) => {
		fixture.load.mockRejectedValueOnce(new Error(message));
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason });
	});
	it.each(['assets', 'download', 'engine'])(
		'preserves %s failure rather than classifying it as GPU',
		async (reason) => {
			const { STTLoadError } = await import('./browser-stt-load');
			fixture.read.mockRejectedValueOnce(
				new STTLoadError(reason as 'assets' | 'download' | 'engine')
			);
			const scope = await worker(adapter());
			await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
			expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason });
			expect(fixture.load).not.toHaveBeenCalled();
		}
	);
	it('uses asyncify, explicit backend and CPU VAD without requiring FP16', async () => {
		const hardware = adapter();
		const scope = await worker(hardware);
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		expect(fixture.initialize.mock.calls[0][0][0].url).toContain('asyncify.wasm');
		expect(fixture.initialize.mock.calls[0][0]).toContainEqual(
			expect.objectContaining({
				id: 'mel-runtime',
				url: '/stt/runtime/ort-wasm-simd-threaded.wasm'
			})
		);
		expect(fixture.ortEnv.wasm.wasmPaths).toMatchObject({
			mjs: expect.stringContaining('asyncify.mjs')
		});
		expect(fixture.ortEnv.webgpu.adapter).toBe(hardware);
		expect(fixture.load).toHaveBeenCalledWith(expect.anything(), 'webgpu');
		expect(fixture.create).toHaveBeenCalledWith(expect.anything(), {
			executionProviders: ['wasm']
		});
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready', backend: 'webgpu' });
	});

	it('keeps default Parakeet WASM on plain runtime', async () => {
		const scope = await worker(null);
		await scope.onmessage({ data: { type: 'load', model: 'parakeet' } });
		expect(fixture.initialize.mock.calls[0][0][0].url).toBe(
			'/stt/runtime/ort-wasm-simd-threaded.wasm'
		);
		expect(fixture.load).toHaveBeenCalledWith(expect.anything(), 'wasm');
		expect(scope.navigator.gpu.requestAdapter).not.toHaveBeenCalled();
	});

	it.each([null, adapter(true), { info: {}, features: { has: (): boolean => true } }])(
		'rejects absent, software or unconfirmed hardware before asset download (%j)',
		async (gpuAdapter) => {
			const scope = await worker(gpuAdapter as ReturnType<typeof adapter> | null);
			await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
			expect(fixture.read).not.toHaveBeenCalled();
			expect(fixture.load).not.toHaveBeenCalled();
			expect(scope.postMessage).toHaveBeenCalledWith({ type: 'error', reason: 'gpu' });
		}
	);

	it('still rejects Whisper GPU without FP16 before download', async () => {
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'base', backend: 'webgpu' } });
		expect(fixture.read).not.toHaveBeenCalled();
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'error', reason: 'gpu' });
	});

	it('reports GPU load failure without CPU reload', async () => {
		fixture.load.mockRejectedValue(new Error('GPU session failed'));
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		expect(fixture.load).toHaveBeenCalledOnce();
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'error', reason: 'gpu' });
	});

	it('releases previous nested mel helper on explicit reload', async () => {
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(fixture.load).toHaveBeenCalledTimes(2);
	});

	it('releases nested helper if CPU VAD initialization fails after GPU model load', async () => {
		fixture.create.mockRejectedValueOnce(new Error('VAD failed'));
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason: 'gpu' });
	});

	it('reports GPU inference failure without exposing errors or retrying CPU', async () => {
		fixture.recognize.mockRejectedValue(new Error('private model exception'));
		const scope = await worker(adapter());
		await scope.onmessage({ data: { type: 'load', model: 'parakeet', backend: 'webgpu' } });
		await scope.onmessage({
			data: { type: 'recognize', language: 'en', id: 1, audio: new Float32Array(16000).buffer }
		});
		expect(fixture.load).toHaveBeenCalledOnce();
		expect(fixture.recognize).toHaveBeenCalledOnce();
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', reason: 'gpu' });
	});
});
