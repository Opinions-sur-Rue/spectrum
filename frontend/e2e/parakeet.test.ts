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
		const worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
		const request = (message: Record<string, unknown>): Promise<Record<string, unknown>> =>
			new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Parakeet timeout')), 120000);
				worker.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('Parakeet worker error'));
				};
				worker.onmessage = ({ data }) => {
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
			return { speech, silence, auto, inferenceMs };
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
	expect(external).toEqual([]);
});
