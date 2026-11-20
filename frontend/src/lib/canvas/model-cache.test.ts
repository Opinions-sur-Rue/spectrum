import { afterEach, expect, it, vi } from 'vitest';
import { clearModelCache, MODEL_CACHE_NAME, WHISPER_CACHE_NAME } from './model-cache';

afterEach(() => vi.unstubAllGlobals());

it('deletes only the public model cache, not other caches or local storage', async () => {
	const entries = new Set([MODEL_CACHE_NAME, 'unrelated-app-cache']);
	const remove = vi.fn(async (key: string) => entries.delete(key));
	const clear = vi.fn();
	const removeItem = vi.fn();
	vi.stubGlobal('caches', { delete: remove, keys: async () => [...entries] });
	vi.stubGlobal('localStorage', { clear, removeItem });
	await clearModelCache();
	expect(remove).toHaveBeenCalledExactlyOnceWith(MODEL_CACHE_NAME);
	expect([...entries]).toEqual(['unrelated-app-cache']);
	expect(clear).not.toHaveBeenCalled();
	expect(removeItem).not.toHaveBeenCalled();
	await expect(clearModelCache()).resolves.toBeUndefined();
});

it('removes only same-origin Whisper Base entries from the Transformers cache', async () => {
	const requests = [
		{ url: 'https://spectrum.test/stt/models/whisper-base/onnx/encoder_model_quantized.onnx' },
		{ url: 'https://spectrum.test/stt/models/whisper-base/tokenizer.json?version=1' },
		{ url: 'https://spectrum.test/other-model/model.onnx' },
		{ url: 'https://other.test/stt/models/whisper-base/config.json' },
		{ url: 'https://spectrum.test/stt/models/whisper-base-other/config.json' }
	];
	const removeEntry = vi.fn().mockResolvedValue(true);
	const removeCache = vi.fn().mockResolvedValue(true);
	vi.stubGlobal('location', { origin: 'https://spectrum.test' });
	vi.stubGlobal('caches', {
		delete: removeCache,
		keys: async () => [MODEL_CACHE_NAME, WHISPER_CACHE_NAME],
		open: vi.fn(async () => ({ keys: async () => requests, delete: removeEntry }))
	});
	await clearModelCache();
	expect(removeCache).toHaveBeenCalledExactlyOnceWith(MODEL_CACHE_NAME);
	expect(removeEntry).toHaveBeenCalledTimes(2);
	expect(removeEntry).toHaveBeenNthCalledWith(1, requests[0]);
	expect(removeEntry).toHaveBeenNthCalledWith(2, requests[1]);
});

it('reports unavailable or denied storage instead of claiming success', async () => {
	vi.stubGlobal('caches', undefined);
	await expect(clearModelCache()).rejects.toThrow();
	vi.stubGlobal('caches', { delete: vi.fn().mockRejectedValue(new Error('denied')) });
	await expect(clearModelCache()).rejects.toThrow('denied');
});
