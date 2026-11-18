import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STT_RUNTIMES } from './browser-stt-public-assets';

const fixture = vi.hoisted(() => ({
	create: vi.fn(),
	run: vi.fn(),
	release: vi.fn(),
	dispose: vi.fn(),
	env: { wasm: {} as Record<string, unknown> }
}));
vi.mock('onnxruntime-web/wasm', () => ({
	env: fixture.env,
	InferenceSession: { create: fixture.create },
	Tensor: class {
		dispose = fixture.dispose;
		constructor(
			public type: string,
			public data: unknown,
			public dims: number[]
		) {}
	}
}));

async function worker() {
	const scope = {
		location: { origin: 'http://localhost' },
		postMessage: vi.fn(),
		close: vi.fn(),
		onmessage: null as unknown as (event: { data: Record<string, unknown> }) => Promise<void>
	};
	vi.stubGlobal('self', scope);
	await import('./parakeet-mel-worker');
	return scope;
}
const load = () => ({
	data: {
		type: 'load',
		id: 0,
		model: new Uint8Array([1]),
		runtime: new Uint8Array([2]),
		moduleURL: 'http://localhost' + STT_RUNTIMES.plain.module
	}
});

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	fixture.release.mockResolvedValue(undefined);
	fixture.create.mockResolvedValue({ run: fixture.run, release: fixture.release });
});
afterEach(() => vi.unstubAllGlobals());

describe('plain-runtime mel worker', () => {
	it('accepts only pinned module URL, verified buffers, and creates CPU session', async () => {
		const scope = await worker();
		await scope.onmessage(load());
		expect(fixture.create).toHaveBeenCalledWith(new Uint8Array([1]), {
			executionProviders: ['wasm'],
			logSeverityLevel: 3
		});
		expect(fixture.env.wasm.wasmPaths).toMatchObject({
			mjs: 'http://localhost' + STT_RUNTIMES.plain.module,
			wasm: expect.stringMatching(/^blob:/)
		});
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready', id: 0 });
	});

	it('refuses alternate module URL without opening model', async () => {
		const scope = await worker();
		const request = load();
		request.data.moduleURL = 'https://example.com/other.mjs';
		await scope.onmessage(request);
		expect(fixture.create).not.toHaveBeenCalled();
		expect(scope.postMessage).toHaveBeenCalledWith({ type: 'error', id: 0 });
		expect(scope.close).toHaveBeenCalledOnce();
	});

	it('copies and transfers only feature outputs and disposes source tensors', async () => {
		const scope = await worker();
		await scope.onmessage(load());
		const features = { data: new Float32Array(128), dims: [1, 128, 1], dispose: vi.fn() };
		const length = { data: BigInt64Array.of(1n), dims: [1], dispose: vi.fn() };
		fixture.run.mockResolvedValueOnce({ features, features_lens: length });
		await scope.onmessage({ data: { type: 'run', id: 1, audio: new Float32Array(16000) } });
		const [message, transfers] = scope.postMessage.mock.calls[1];
		expect(message).toMatchObject({ type: 'features', id: 1, dims: [1, 128, 1], lengthDims: [1] });
		expect(message.features.buffer).not.toBe(features.data.buffer);
		expect(transfers).toHaveLength(2);
		expect(features.dispose).toHaveBeenCalledOnce();
		expect(length.dispose).toHaveBeenCalledOnce();
		expect(fixture.dispose).toHaveBeenCalledTimes(2);
	});

	it('rejects oversized audio, releases session and closes without inference', async () => {
		const scope = await worker();
		await scope.onmessage(load());
		await scope.onmessage({ data: { type: 'run', id: 1, audio: new Float32Array(192001) } });
		expect(fixture.run).not.toHaveBeenCalled();
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'error', id: 1 });
		expect(scope.close).toHaveBeenCalledOnce();
	});
});
