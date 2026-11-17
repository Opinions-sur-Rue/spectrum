import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('Redux WASM transcribes a public fixture with no external requests and rejects silence', async ({
	page
}) => {
	test.skip(!process.env.SPECTRUM_TEST_SPEECH, 'Prepare Parakeet assets and a public WAV fixture.');
	const fixture = readFileSync(process.env.SPECTRUM_TEST_SPEECH!);
	const external: string[] = [];
	page.on('request', (request) => {
		if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1')
			external.push(request.url());
	});
	await page.route('https://**/*', (route) => route.abort());
	await page.route('**/parakeet-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Parakeet fixture</title>'
		})
	);
	await page.route('**/fixture.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: fixture })
	);
	await page.goto('/parakeet-harness');
	const result = await page.evaluate(async (language) => {
		const context = new OfflineAudioContext(1, 1, 16000);
		const decoded = await context.decodeAudioData(
			await (await fetch('/fixture.wav')).arrayBuffer()
		);
		const audio = decoded.getChannelData(0);
		if (decoded.sampleRate !== 16000 || audio.length > 192000)
			throw new Error('Public fixture must be at most 12 seconds');
		let worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
		const cacheHits: string[] = [];
		let cacheUnavailable = false;
		const request = (message: Record<string, unknown>): Promise<Record<string, unknown>> =>
			new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Parakeet timeout')), 120000);
				worker.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('Parakeet worker error'));
				};
				worker.onmessage = ({ data }) => {
					if (data.type === 'progress' && data.progress?.cacheAvailable === false)
						cacheUnavailable = true;
					if (data.type === 'progress' && data.progress?.cached)
						cacheHits.push(data.progress.asset);
					if (['ready', 'error', 'result'].includes(data.type)) {
						clearTimeout(timeout);
						resolve(data);
					}
				};
				worker.postMessage(message);
			});
		try {
			const loaded = await request({ type: 'load', model: 'parakeet', backend: 'wasm' });
			if (loaded.type !== 'ready') throw new Error('Parakeet load failed');
			const started = performance.now();
			const speech = await request({ type: 'recognize', id: 1, language, audio: audio.buffer });
			const inferenceMs = Math.round(performance.now() - started);
			const silence = await request({
				type: 'recognize',
				id: 2,
				language,
				audio: new Float32Array(64000).buffer
			});
			const auto = await request({
				type: 'recognize',
				id: 3,
				language: 'auto',
				audio: audio.slice().buffer
			});
			worker.terminate();
			worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
			const reloaded = await request({ type: 'load', model: 'parakeet', backend: 'wasm' });
			return { speech, silence, auto, inferenceMs, reloaded, cacheHits, cacheUnavailable };
		} finally {
			worker.terminate();
		}
	}, process.env.SPECTRUM_TEST_LANGUAGE ?? 'en');
	await test.info().attach('public-fixture-parakeet.json', {
		body: JSON.stringify(result, null, 2),
		contentType: 'application/json'
	});
	console.info('PARAKEET PUBLIC FIXTURE', JSON.stringify(result));
	expect(result.speech.type).toBe('result');
	expect(result.speech.text).toMatch(
		new RegExp(process.env.SPECTRUM_TEST_EXPECT ?? 'country', 'i')
	);
	expect(result.silence).toMatchObject({ type: 'result', text: '', noSpeech: true });
	expect(result.auto.type).toBe('error');
	expect(result.reloaded.type).toBe('ready');
	if (result.cacheUnavailable)
		test.info().annotations.push({
			type: 'cache-unavailable',
			description:
				'Recognition and reload work without cache; storage operations failed or writes were discarded.'
		});
	else
		expect(result.cacheHits).toEqual(
			expect.arrayContaining(['runtime', 'vocabulary', 'features', 'encoder', 'decoder', 'vad'])
		);
	expect(external).toEqual([]);
});

test('cache refusal includes silently discarded writes and failed reads', async ({ page }) => {
	await page.route('**/parakeet-harness', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cache refusal</title>' })
	);
	await page.route('**/stt/cache-probe.bin?*', (route) =>
		route.fulfill({ contentType: 'application/octet-stream', body: 'abc' })
	);
	await page.goto('/parakeet-harness');
	const results = await page.evaluate(async () => {
		const modulePath = '/src/lib/canvas/browser-stt-load.ts';
		const { STTAssetLoader } = await import(/* @vite-ignore */ modulePath);
		const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
		const results = [];
		try {
			for (const mode of ['discard', 'read-error', 'write-error']) {
				let writes = 0;
				Object.defineProperty(globalThis, 'caches', {
					configurable: true,
					value: {
						open: async () => ({
							match: async () => {
								if (mode === 'read-error') throw new Error('Storage refused');
								return undefined;
							},
							put: async () => {
								writes++;
								if (mode === 'write-error') throw new Error('Storage refused');
							}
						})
					}
				});
				const availability: (boolean | undefined)[] = [];
				const loader = new STTAssetLoader(
					[
						{
							id: 'encoder',
							url: '/stt/cache-probe.bin',
							bytes: 3,
							sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
						}
					],
					(value: { cacheAvailable?: boolean }) => availability.push(value.cacheAvailable)
				);
				const data = new TextDecoder().decode(await loader.read('encoder'));
				results.push({ mode, data, writes, cacheAvailable: availability.at(-1) });
			}
		} finally {
			if (original) Object.defineProperty(globalThis, 'caches', original);
			else Reflect.deleteProperty(globalThis, 'caches');
		}
		return results;
	});
	expect(results).toEqual(
		['discard', 'read-error', 'write-error'].map((mode) => ({
			mode,
			data: 'abc',
			writes: 1,
			cacheAvailable: false
		}))
	);
});

test('removed Whisper tiers fail before any public model request', async ({ page }) => {
	const assets: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/stt/')) assets.push(request.url());
	});
	await page.route('**/parakeet-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Removed models</title>'
		})
	);
	await page.goto('/parakeet-harness');
	const results = await page.evaluate(async () => {
		const results = [];
		for (const model of ['tiny', 'small']) {
			const worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
			try {
				results.push(
					await new Promise<string>((resolve, reject) => {
						const timeout = setTimeout(() => reject(new Error('Removed tier not rejected')), 15000);
						worker.onmessage = ({ data }) => {
							if (data.type === 'error') {
								clearTimeout(timeout);
								resolve(data.reason);
							}
						};
						worker.postMessage({ type: 'load', model, backend: 'wasm' });
					})
				);
			} finally {
				worker.terminate();
			}
		}
		return results;
	});
	expect(results).toEqual(['engine', 'engine']);
	expect(assets).toEqual([]);
});
