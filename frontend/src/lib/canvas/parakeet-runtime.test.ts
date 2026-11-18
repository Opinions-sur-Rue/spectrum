import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { STTAssetLoader } from './browser-stt-load';

const fixture = vi.hoisted(() => ({
	create: vi.fn(),
	createMel: vi.fn(),
	melRun: vi.fn(),
	melRelease: vi.fn()
}));
vi.mock('./parakeet-mel-bridge', () => ({ openParakeetMel: fixture.createMel }));
vi.mock('onnxruntime-web/webgpu', () => ({
	InferenceSession: { create: fixture.create },
	Tensor: class {
		dispose = vi.fn();
		constructor(
			public type: string,
			public data: unknown,
			public dims: number[]
		) {}
	}
}));

import { ParakeetRuntime } from './parakeet-runtime';

function assets() {
	const vocabulary = Array.from(
		{ length: 8193 },
		(_, id) => `${id === 8192 ? '<blk>' : `token${id}`} ${id}`
	).join('\n');
	return {
		read: vi.fn(async (id: string) =>
			new TextEncoder().encode(id === 'vocabulary' ? vocabulary : id)
		),
		initializing: vi.fn()
	} as unknown as STTAssetLoader;
}

function session() {
	return { run: vi.fn(), release: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
	fixture.create.mockReset();
	fixture.createMel
		.mockReset()
		.mockResolvedValue({ run: fixture.melRun, release: fixture.melRelease });
	fixture.melRun.mockReset();
	fixture.melRelease.mockReset();
	vi.stubGlobal('location', { origin: 'http://localhost' });
});
afterEach(() => vi.unstubAllGlobals());

describe('Parakeet session backends', () => {
	it('defaults every session to WASM', async () => {
		fixture.create.mockImplementation(async () => session());
		await ParakeetRuntime.load(assets());
		expect(fixture.create.mock.calls.map(([, options]) => options.executionProviders)).toEqual([
			['wasm'],
			['wasm'],
			['wasm']
		]);
	});

	it('uses hybrid WebGPU only for the encoder, without changing asset IDs', async () => {
		fixture.create.mockImplementation(async () => session());
		const loader = assets();
		await ParakeetRuntime.load(loader, 'webgpu');
		expect(fixture.create.mock.calls.map(([, options]) => options.executionProviders)).toEqual([
			['webgpu', 'wasm'],
			['wasm']
		]);
		expect(vi.mocked(loader.read).mock.calls.map(([id]) => id)).toEqual([
			'vocabulary',
			'features',
			'mel-runtime',
			'encoder',
			'decoder'
		]);
	});

	it('releases mel helper on GPU load failure and never retries CPU', async () => {
		const error = new Error('GPU unavailable');
		fixture.create.mockRejectedValueOnce(error);
		await expect(ParakeetRuntime.load(assets(), 'webgpu')).rejects.toBe(error);
		expect(fixture.melRelease).toHaveBeenCalledOnce();
		expect(fixture.create).toHaveBeenCalledOnce();
	});

	it('propagates encoder inference failure without replacing the session', async () => {
		const encoder = session();
		const joint = session();
		fixture.melRun.mockResolvedValue({
			features: new Float32Array(128),
			dims: [1, 128, 1],
			length: BigInt64Array.of(1n),
			lengthDims: [1]
		});
		const error = new Error('Device lost');
		encoder.run.mockRejectedValue(error);
		fixture.create.mockResolvedValueOnce(encoder).mockResolvedValueOnce(joint);
		const runtime = await ParakeetRuntime.load(assets(), 'webgpu');
		await expect(runtime.recognize(new Float32Array(16000))).rejects.toBe(error);
		expect(fixture.create).toHaveBeenCalledTimes(2);
		expect(joint.run).not.toHaveBeenCalled();
		await runtime.release();
		expect(fixture.melRelease).toHaveBeenCalledOnce();
		expect(encoder.release).toHaveBeenCalledOnce();
		expect(joint.release).toHaveBeenCalledOnce();
	});
});
