/** Public speech assets only. Never include identity or private note storage. */
export const MODEL_CACHE_NAME = 'spectrum-stt-public-v1';
export const WHISPER_CACHE_NAME = 'transformers-cache';

export async function clearModelCache(): Promise<void> {
	if (typeof caches === 'undefined') throw new Error('Cache storage unavailable');
	// false means there was no cache to remove, which is also a successful clear.
	await caches.delete(MODEL_CACHE_NAME);
	// Transformers also stores Whisper files in its library cache. Do not delete
	// that entire namespace: other same-origin features may use it.
	if (!(await caches.keys()).includes(WHISPER_CACHE_NAME)) return;
	const whisper = await caches.open(WHISPER_CACHE_NAME);
	for (const request of await whisper.keys()) {
		const url = new URL(request.url);
		if (url.origin === location.origin && url.pathname.startsWith('/stt/models/whisper-base/')) {
			await whisper.delete(request);
		}
	}
}
