import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { englishLocale } from './locale-state';
import { openTranscript } from './discussion';

test('real local Silero gate rejects silence, tones, noise and clicks before Whisper decoding', async ({
	page
}) => {
	test.skip(!process.env.SPECTRUM_TEST_SPEECH, 'Requires prepared local STT assets.');
	await page.route('https://**/*', (route) => route.abort());
	await page.route('**/browser-stt-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Local STT fixture harness</title>'
		})
	);
	await page.goto('/browser-stt-harness');
	const results = await page.evaluate(async () => {
		const worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
		function request(
			message: Record<string, unknown>,
			expected: string
		): Promise<Record<string, unknown>> {
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Local gate test timed out')), 120000);
				worker.onmessage = ({ data }) => {
					if (data.type === 'error' || data.type === expected) {
						clearTimeout(timeout);
						if (data.type === 'error') reject(new Error('Local gate failed'));
						else resolve(data);
					}
				};
				worker.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('Local worker failed'));
				};
				worker.postMessage(message);
			});
		}
		try {
			await request({ type: 'load', model: 'tiny' }, 'ready');
			const results = [];
			let random = 7;
			for (const kind of ['silence', 'tone', 'noise', 'clicks']) {
				const audio = Float32Array.from({ length: 64000 }, (_, i) => {
					if (kind === 'tone') return 0.15 * Math.sin((2 * Math.PI * 440 * i) / 16000);
					if (kind === 'clicks') return i % 8000 < 8 ? 0.7 : 0;
					if (kind === 'noise') {
						random = (Math.imul(random, 1664525) + 1013904223) | 0;
						return (random / 2147483648) * 0.15;
					}
					return 0;
				});
				const output = await request(
					{ type: 'recognize', id: results.length + 1, language: 'fr', audio: audio.buffer },
					'result'
				);
				results.push({ kind, text: output.text, noSpeech: output.noSpeech });
			}
			return results;
		} finally {
			worker.terminate();
		}
	});
	for (const result of results)
		expect(result, result.kind).toMatchObject({ text: '', noSpeech: true });
});

test('selected models transcribe the same complete public fixture for comparison', async ({
	page
}) => {
	test.skip(
		process.env.SPECTRUM_TEST_COMPARE !== 'true' || !process.env.SPECTRUM_TEST_SPEECH,
		'Explicit public-fixture comparison only.'
	);
	const wav = readFileSync(process.env.SPECTRUM_TEST_SPEECH!);
	await page.route('https://**/*', (route) => route.abort());
	await page.route('**/browser-stt-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Local STT comparison</title>'
		})
	);
	await page.route('**/browser-stt-fixture.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: wav })
	);
	await page.goto('/browser-stt-harness');
	const results = await page.evaluate(
		async ({ language, models, backends }) => {
			const context = new AudioContext({ sampleRate: 16000 });
			const clip = await context.decodeAudioData(
				await (await fetch('/browser-stt-fixture.wav')).arrayBuffer()
			);
			if (clip.sampleRate !== 16000) throw new Error('Fixture must decode at 16 kHz');
			const audio = clip.getChannelData(0).slice();
			await context.close();
			const results = [];
			for (const model of models) {
				for (const backend of backends) {
					const worker = new Worker('/src/lib/canvas/browser-stt-worker.ts', { type: 'module' });
					const request = (
						message: Record<string, unknown>,
						expected: string
					): Promise<Record<string, unknown>> =>
						new Promise((resolve, reject) => {
							const timer = setTimeout(
								() => reject(new Error('Fixture comparison timed out')),
								120000
							);
							worker.onmessage = ({ data }) => {
								if (data.type === expected || data.type === 'error') {
									clearTimeout(timer);
									if (data.type === 'error')
										reject(new Error(`Fixture model failed: ${model}/${backend}:${data.reason}`));
									else resolve(data);
								}
							};
							worker.onerror = () => {
								clearTimeout(timer);
								reject(new Error('Fixture worker failed'));
							};
							worker.postMessage(message);
						});
					try {
						const loaded = await request({ type: 'load', model, backend }, 'ready');
						if (loaded.backend !== backend) throw new Error('Unexpected inference backend');
						const started = performance.now();
						const output = await request(
							// Each postMessage transfers (detaches) this buffer; send a fresh copy.
							{ type: 'recognize', id: 1, language, audio: audio.slice().buffer },
							'result'
						);
						results.push({
							model,
							backend,
							text: output.text,
							inferenceMs: Math.round(performance.now() - started)
						});
					} finally {
						worker.terminate();
					}
				}
			}
			return results;
		},
		{
			language: process.env.SPECTRUM_TEST_LANGUAGE ?? 'fr',
			models: (process.env.SPECTRUM_TEST_MODELS ?? 'tiny,base').split(','),
			backends: (
				process.env.SPECTRUM_TEST_BACKENDS ??
				(process.env.SPECTRUM_TEST_WEBGPU === 'true' ? 'wasm,webgpu' : 'wasm')
			).split(',')
		}
	);
	await test.info().attach('public-fixture-comparison.json', {
		body: JSON.stringify(results, null, 2),
		contentType: 'application/json'
	});
	console.info('IDENTICAL PUBLIC FIXTURE:', JSON.stringify(results));
	for (const result of results)
		expect(result.text).toMatch(new RegExp(process.env.SPECTRUM_TEST_EXPECT ?? 'pays|faire', 'i'));
});

test('real browser local inference transcribes own opted-in microphone or explicitly stops for capacity; voice survives', async ({
	page,
	browser,
	browserName
}) => {
	test.skip(
		!process.env.SPECTRUM_TEST_SPEECH,
		'Provide a public 16 kHz WAV fixture. Browser-mode backend and local model assets required.'
	);
	const wav = readFileSync(process.env.SPECTRUM_TEST_SPEECH!);
	const modelRequests: string[] = [];
	const externalRequests: string[] = [];
	const publications: unknown[] = [];
	// Existing legacy font/CSS URLs are unrelated to ASR. Block every external
	// HTTPS request: local recognition must work without third-party services.
	await page.route('https://**/*', (route) => route.abort());
	page.on('request', (request) => {
		const url = request.url();
		if (url.includes('/stt/')) modelRequests.push(url);
		if (/^https?:/.test(url) && !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
			externalRequests.push(url);
	});
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/spectrum/ws')) return;
		socket.on('framesent', ({ payload }) => {
			const event = JSON.parse(String(payload));
			if (event.op === 'transcript.publish') publications.push(event.payload);
		});
	});
	await page.route('**/browser-stt-fixture.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: wav })
	);
	await page.addInitScript(() => {
		(window as unknown as { captureCalls: number }).captureCalls = 0;
		navigator.mediaDevices.getUserMedia = async () => {
			(window as unknown as { captureCalls: number }).captureCalls++;
			const context = new AudioContext();
			const clip = await context.decodeAudioData(
				await (await fetch('/browser-stt-fixture.wav')).arrayBuffer()
			);
			const padded = context.createBuffer(
				1,
				clip.length + context.sampleRate * 2,
				context.sampleRate
			);
			padded.copyToChannel(clip.getChannelData(0), 0);
			const source = context.createBufferSource();
			source.buffer = padded;
			source.loop = true;
			const destination = context.createMediaStreamDestination();
			source.connect(destination);
			await context.resume();
			source.start();
			for (const track of destination.stream.getTracks()) {
				const stop = track.stop.bind(track);
				track.stop = () => {
					stop();
					void context.close().catch(() => {});
				};
			}
			return destination.stream;
		};
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await expect(page.getByTestId('browser-stt-toggle')).toBeDisabled();
	expect(modelRequests).toHaveLength(0);
	const language = process.env.SPECTRUM_TEST_LANGUAGE ?? 'fr';
	if (language !== 'fr') {
		await page.getByLabel('Room options', { exact: true }).click();
		await page
			.getByLabel('Transcription language (restarts audio)', { exact: true })
			.selectOption(language);
		await page.getByLabel('Room options', { exact: true }).click();
	}
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected', {
		timeout: 15000
	});
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
	await page.getByTestId('audio-options').click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(publications).toHaveLength(0);
	expect(modelRequests).toHaveLength(0);
	await page.getByTestId('browser-stt-toggle').click();
	await expect(page.getByRole('dialog')).toContainText('75 MB');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(modelRequests).toHaveLength(0);
	await page.getByTestId('browser-stt-toggle').click();
	const legacyExternalRequests = new Set(externalRequests);
	const selectedModel = process.env.SPECTRUM_TEST_MODEL;
	if (selectedModel === 'base' || selectedModel === 'small') {
		await page.getByTestId('browser-stt-model').selectOption(selectedModel);
		await expect(page.getByRole('dialog')).toContainText(
			selectedModel === 'small' ? '515 MB' : '110 MB'
		);
	}
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		if (selectedModel === 'small') {
			await expect(page.getByTestId('browser-stt-webgpu')).toBeChecked();
		} else {
			const gpu = page.getByTestId('browser-stt-webgpu');
			await expect(gpu).toBeVisible();
			await gpu.check();
			await expect(page.getByRole('dialog')).toContainText(
				selectedModel === 'base' ? '180 MB' : '110 MB'
			);
		}
	}
	await page.getByTestId('browser-stt-confirm').click();
	const controls = page.getByTestId('browser-stt-controls');
	await Promise.race([
		expect(controls).toHaveAttribute('data-state', 'active', { timeout: 120000 }),
		controls
			.getByRole('alert')
			.waitFor({ state: 'visible', timeout: 120000 })
			.then(async () => {
				throw new Error(await controls.innerText());
			})
	]);
	const transcript = await openTranscript(page);
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		expect(modelRequests.some((url) => url.endsWith('ort-wasm-simd-threaded.asyncify.wasm'))).toBe(
			true
		);
		expect(modelRequests.some((url) => url.endsWith('_fp16.onnx'))).toBe(true);
	}
	const outcome = await Promise.race([
		expect(
			transcript
				.locator('[data-transcript-final="true"]')
				.filter({ hasText: new RegExp(process.env.SPECTRUM_TEST_EXPECT ?? 'pays|faire', 'i') })
				.first()
		)
			.toBeVisible({ timeout: 60000 })
			.then(() => 'transcribed'),
		controls
			.getByRole('alert')
			.waitFor({ state: 'visible', timeout: 60000 })
			.then(async () => {
				const message = await controls.innerText();
				if (browserName === 'firefox' && message.includes('could not keep up'))
					return 'capacity-stop';
				throw new Error(`${message} (published segments: ${publications.length})`);
			})
	]);
	expect(
		await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
	).toBe(1);
	expect(externalRequests.filter((url) => !legacyExternalRequests.has(url))).toEqual([]);
	if (outcome === 'capacity-stop') {
		test.info().annotations.push({
			type: 'capacity-limit',
			description: 'Firefox stopped safely; NOT a successful transcription result.'
		});
		console.info('CAPACITY LIMIT: Firefox local ASR stopped safely; voice stayed active.');
		await expect(controls).toHaveAttribute('data-state', 'off');
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		const sent = publications.length;
		await page.waitForTimeout(2500);
		expect(publications).toHaveLength(sent);
		await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
		return;
	}
	console.info('REAL TRANSCRIPTION: browser inference and shared captions verified.');
	if (process.env.SPECTRUM_TEST_REPORT === 'true')
		console.info('PUBLIC FIXTURE CAPTIONS:', JSON.stringify(publications));
	expect(publications.length).toBeGreaterThan(0);
	for (const payload of publications) {
		expect(payload).not.toHaveProperty('audio');
		expect(payload).not.toHaveProperty('speakerId');
	}
	await expect(transcript).toContainText('Automatic · browser supplied');
	// Stop before opening another browser: slower devices may exhaust their
	// bounded queue while that browser starts. History must survive either stop.
	if ((await controls.getAttribute('data-state')) !== 'off') {
		await page.getByTestId('browser-stt-toggle').click();
	} else {
		expect(browserName).toBe('firefox');
		await expect(controls.getByRole('alert')).toContainText('could not keep up');
		test.info().annotations.push({
			type: 'capacity-after-inference',
			description: 'Inference succeeded, then Firefox stopped for capacity.'
		});
	}
	await expect(controls).toHaveAttribute('data-state', 'off');
	const context = await browser.newContext({ storageState: englishLocale });
	try {
		const spectator = await context.newPage();
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await expect(spectator.getByTestId('browser-stt-controls')).toHaveCount(0);
		const history = await openTranscript(spectator);
		await expect(history.locator('[data-transcript-final="true"]').first()).toBeVisible();
		await expect(spectator.getByRole('region', { name: 'Room transcript' })).toContainText('0/1');
		await expect(page.getByTestId('browser-stt-controls')).toHaveAttribute('data-state', 'off');
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		const sent = publications.length;
		await page.waitForTimeout(2500); // Deliberately allow any stale in-flight result to arrive.
		expect(publications).toHaveLength(sent);
		await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
		await expect(page.getByTestId('browser-stt-toggle')).toBeDisabled();
	} finally {
		await context.close();
	}
});
