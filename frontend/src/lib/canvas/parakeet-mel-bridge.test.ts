import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openParakeetMel } from './parakeet-mel-bridge';

class FakeWorker {
	static current: FakeWorker;
	onmessage?: (event: { data: unknown }) => void;
	onerror?: () => void;
	onmessageerror?: () => void;
	postMessage =
		vi.fn<
			(
				message: { type: string; model?: Uint8Array; audio?: Float32Array; moduleURL?: string },
				transfers: Transferable[]
			) => void
		>();
	terminate = vi.fn();
	constructor() {
		FakeWorker.current = this;
	}
	reply(data: unknown) {
		this.onmessage?.({ data });
	}
}
const bytes = new Uint8Array([1, 2]);
const features = () => ({
	type: 'features',
	id: 1,
	features: new Float32Array(128),
	dims: [1, 128, 1],
	length: BigInt64Array.of(1n),
	lengthDims: [1]
});

beforeEach(() => {
	vi.stubGlobal('Worker', FakeWorker);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function ready() {
	const loading = openParakeetMel(bytes, bytes, 'http://localhost/plain.mjs');
	FakeWorker.current.reply({ type: 'ready', id: 0 });
	return loading;
}

describe('isolated Parakeet mel bridge', () => {
	it('transfers owned model/runtime copies, then bounded audio and typed features', async () => {
		const mel = await ready();
		const worker = FakeWorker.current;
		const [load, transfers] = worker.postMessage.mock.calls[0];
		expect(load).toMatchObject({ type: 'load', moduleURL: 'http://localhost/plain.mjs' });
		expect(transfers).toHaveLength(2);
		expect(load.model!.buffer).not.toBe(bytes.buffer);
		const audio = new Float32Array(16000);
		const running = mel.run(audio);
		expect(worker.postMessage.mock.calls[1][0].audio!.buffer).not.toBe(audio.buffer);
		const output = features();
		worker.reply(output);
		expect(await running).toBe(output);
		mel.release();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects concurrent calls and oversized audio without sending either', async () => {
		const mel = await ready();
		const running = mel.run(new Float32Array(16000));
		await expect(mel.run(new Float32Array(16000))).rejects.toThrow('busy');
		await expect(mel.run(new Float32Array(192001))).rejects.toThrow('Audio limit');
		expect(FakeWorker.current.postMessage).toHaveBeenCalledTimes(2);
		FakeWorker.current.reply(features());
		await running;
		mel.release();
	});

	it('terminates and rejects a hung initialization', async () => {
		const loading = openParakeetMel(bytes, bytes, 'http://localhost/plain.mjs');
		const rejected = expect(loading).rejects.toThrow('unavailable');
		await vi.advanceTimersByTimeAsync(120000);
		await rejected;
		expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
	});

	it.each(['error', 'messageerror', 'release', 'wrong-id', 'invalid-features', 'timeout'])(
		'fails closed and cleans pending request on %s',
		async (mode) => {
			const mel = await ready();
			const running = mel.run(new Float32Array(16000));
			const rejected = expect(running).rejects.toThrow();
			const worker = FakeWorker.current;
			if (mode === 'error') worker.onerror?.();
			else if (mode === 'messageerror') worker.onmessageerror?.();
			else if (mode === 'release') mel.release();
			else if (mode === 'wrong-id') worker.reply({ ...features(), id: 7 });
			else if (mode === 'invalid-features') worker.reply({ ...features(), dims: [1, 128, 1202] });
			else await vi.advanceTimersByTimeAsync(120000);
			await rejected;
			expect(worker.terminate).toHaveBeenCalledOnce();
			await expect(mel.run(new Float32Array(16000))).rejects.toThrow('closed');
			expect(vi.getTimerCount()).toBe(0);
		}
	);
});
