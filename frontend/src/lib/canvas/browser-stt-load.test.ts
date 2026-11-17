import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	STTAssetLoader,
	STTLoadError,
	type STTLoadProgress,
	type STTPublicAsset
} from './browser-stt-load';

const asset: STTPublicAsset = {
	id: 'encoder',
	url: '/stt/model.onnx',
	bytes: 3,
	sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
};
let entries: Map<string, Response>;
let cache: {
	match: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
	entries = new Map();
	cache = {
		match: vi.fn(async (key: string) => entries.get(key)?.clone()),
		put: vi.fn(async (key: string, response: Response) => {
			entries.set(key, response.clone());
		}),
		delete: vi.fn(async (key: string) => entries.delete(key))
	};
	vi.stubGlobal('location', { origin: 'https://spectrum.test' });
	vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('abc', { headers: { 'Content-Length': '1' } }))
	);
});
afterEach(() => vi.unstubAllGlobals());

it('reports decoded bytes, verifies the pin and reuses cached public assets without fetching again', async () => {
	const progress: STTLoadProgress[] = [];
	const loader = new STTAssetLoader([asset], (value) => progress.push(value));
	expect(new TextDecoder().decode(await loader.read('encoder'))).toBe('abc');
	expect(progress.at(-1)).toMatchObject({ phase: 'download', loaded: 3, total: 3 });
	expect(fetch).toHaveBeenCalledOnce();
	expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('sha256=' + asset.sha256);
	const second = new STTAssetLoader([asset], (value) => progress.push(value));
	expect(new TextDecoder().decode(await second.read('encoder'))).toBe('abc');
	expect(fetch).toHaveBeenCalledOnce();
	expect(progress.at(-1)?.cached).toBe(true);
});

it('rejects corrupt data without caching it and discards corrupt cached entries', async () => {
	vi.mocked(fetch).mockResolvedValueOnce(new Response('abd'));
	await expect(new STTAssetLoader([asset], () => {}).read('encoder')).rejects.toMatchObject({
		reason: 'assets'
	});
	expect(cache.put).not.toHaveBeenCalled();
	entries.set('https://spectrum.test/stt/model.onnx?sha256=' + asset.sha256, new Response('abd'));
	await new STTAssetLoader([asset], () => {}).read('encoder');
	expect(cache.delete).toHaveBeenCalledOnce();
});

it('distinguishes missing assets from transport errors, and tolerates unavailable cache storage', async () => {
	vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>', { status: 404 }));
	await expect(new STTAssetLoader([asset], () => {}).read('encoder')).rejects.toMatchObject({
		reason: 'assets'
	});
	vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
	await expect(new STTAssetLoader([asset], () => {}).read('encoder')).rejects.toMatchObject({
		reason: 'download'
	});
	vi.stubGlobal('caches', {
		open: vi.fn(async () => {
			throw new Error('Quota');
		})
	});
	const progress: STTLoadProgress[] = [];
	expect(
		await new STTAssetLoader([asset], (value) => progress.push(value)).read('encoder')
	).toEqual(new TextEncoder().encode('abc'));
	expect(progress.at(-1)?.cacheAvailable).toBe(false);
});

it('refuses external URLs before any request and bounds malformed response lengths', async () => {
	await expect(
		new STTAssetLoader([{ ...asset, url: 'https://external.test/model.onnx' }], () => {}).read(
			'encoder'
		)
	).rejects.toBeInstanceOf(STTLoadError);
	expect(fetch).not.toHaveBeenCalled();
	vi.mocked(fetch).mockResolvedValueOnce(new Response('abcd'));
	await expect(new STTAssetLoader([asset], () => {}).read('encoder')).rejects.toMatchObject({
		reason: 'assets'
	});
});
