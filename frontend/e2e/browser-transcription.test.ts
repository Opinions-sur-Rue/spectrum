import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { englishLocale } from './locale-state';
import { enableTranscription, openTranscript } from './discussion';

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
			await request({ type: 'load', model: 'base' }, 'ready');
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

async function instrumentGpuLoss(page: import('@playwright/test').Page) {
	const failInit = process.env.SPECTRUM_TEST_GPU_INIT_FAIL === 'true';
	// Test-only instrumentation of the actual Vite worker. Destroy the real
	// ORT GPUDevice; do not replace inference or synthesize success/errors.
	await page.route('**/browser-stt-worker.ts*', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: `
const testDevices = [];
const testRequestDevice = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function(...args) {
  if (${JSON.stringify(failInit)}) throw new Error('WebGPU initialization failure (test)');
  const device = await testRequestDevice.apply(this, args);
  testDevices.push(device);
  self.postMessage({type: '__test_device_created'});
  return device;
};
self.addEventListener('message', ({data}) => {
  if (data.type === '__test_destroy_gpu') {
    for (const device of testDevices) device.destroy();
    self.postMessage({type: '__test_device_destroyed', count: testDevices.length});
  }
});
${await response.text()}`
		});
	});
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		const state = {
			workers: [] as Worker[],
			events: [] as {
				worker: number;
				type: string;
				backend?: string;
				reason?: string;
				count?: number;
			}[]
		};
		(window as unknown as { sttTest: typeof state }).sttTest = state;
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (!String(url).includes('browser-stt-worker')) return;
				const worker = state.workers.push(this) - 1;
				const post = this.postMessage.bind(this);
				this.postMessage = ((
					data: { type: string; backend?: string },
					transfer: Transferable[]
				) => {
					state.events.push({ worker, type: `sent:${data.type}`, backend: data.backend });
					post(data, transfer ?? []);
				}) as Worker['postMessage'];
				const terminate = this.terminate.bind(this);
				this.terminate = () => {
					state.events.push({ worker, type: 'terminated' });
					terminate();
				};
				this.addEventListener('message', ({ data }) => {
					if (data.type === 'progress') return;
					state.events.push({
						worker,
						type: data.type,
						backend: data.backend,
						reason: data.reason,
						count: data.count
					});
				});
			}
		};
	});
}

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
			models: (process.env.SPECTRUM_TEST_MODELS ?? 'base,parakeet').split(','),
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
	const testGpuLoss = process.env.SPECTRUM_TEST_GPU_LOSS === 'true';
	const testGpuInitFail = process.env.SPECTRUM_TEST_GPU_INIT_FAIL === 'true';
	const gpuCancel = process.env.SPECTRUM_TEST_GPU_CANCEL;
	if (testGpuLoss || testGpuInitFail || gpuCancel) await instrumentGpuLoss(page);
	const externalRequests: string[] = [];
	const publications: unknown[] = [];
	const starts: { requestId: string }[] = [];
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
			if (event.op === 'transcript.start') starts.push(event.payload);
		});
	});
	await page.route('**/browser-stt-fixture.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: wav })
	);
	await page.addInitScript(
		({ loop }) => {
			(window as unknown as { captureCalls: number }).captureCalls = 0;
			navigator.mediaDevices.getUserMedia = async () => {
				(window as unknown as { captureCalls: number }).captureCalls++;
				const context = new AudioContext();
				const clip = await context.decodeAudioData(
					await (await fetch('/browser-stt-fixture.wav')).arrayBuffer()
				);
				const padded = context.createBuffer(
					1,
					clip.length + context.sampleRate * (loop ? 2 : 3),
					context.sampleRate
				);
				padded.copyToChannel(clip.getChannelData(0), 0, loop ? 0 : context.sampleRate);
				const destination = context.createMediaStreamDestination();
				const play = () => {
					const source = context.createBufferSource();
					source.buffer = padded;
					source.loop = loop;
					source.connect(destination);
					source.start();
				};
				await context.resume();
				if (loop) play();
				else (window as unknown as { startPublicSpeech: () => void }).startPublicSpeech = play;
				for (const track of destination.stream.getTracks()) {
					const stop = track.stop.bind(track);
					track.stop = () => {
						stop();
						void context.close().catch(() => {});
					};
				}
				return destination.stream;
			};
		},
		{ loop: process.env.SPECTRUM_TEST_SPEECH_ONCE !== 'true' }
	);
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await enableTranscription(page);
	await expect(page.getByTestId('browser-stt-toggle')).toBeEnabled();
	expect(modelRequests).toHaveLength(0);
	const language = process.env.SPECTRUM_TEST_LANGUAGE ?? 'fr';
	if (language !== 'fr') {
		await page.getByLabel('Room options', { exact: true }).click();
		await page
			.getByLabel('Transcription language (restarts audio)', { exact: true })
			.selectOption(language);
		await page.getByLabel('Room options', { exact: true }).click();
	}
	await page.getByTestId('audio-options').click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(publications).toHaveLength(0);
	expect(modelRequests).toHaveLength(0);
	await page.getByTestId('browser-stt-toggle').click();
	await expect(page.getByTestId('browser-stt-confirm')).toBeEnabled();
	const defaultGpu = await page
		.getByTestId('browser-stt-webgpu')
		.isChecked()
		.catch(() => false);
	await expect(page.getByRole('dialog')).toContainText(
		language === 'auto' ? (defaultGpu ? '290 MB' : '110 MB') : defaultGpu ? '255 MB' : '225 MB'
	);
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		await expect(page.getByTestId('browser-stt-webgpu')).toBeChecked();
		await page.getByTestId('browser-stt-model').selectOption('base');
		await expect(page.getByTestId('browser-stt-confirm')).toBeEnabled();
		await expect(page.getByTestId('browser-stt-webgpu')).toBeChecked();
		await expect(page.getByRole('dialog')).toContainText('290 MB');
		await expect(page.getByRole('dialog')).toContainText('FP16');
		await expect(page.getByRole('dialog')).toContainText('q8');
		expect(modelRequests).toHaveLength(0);
		expect(
			await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
		).toBe(0);
		await page
			.getByTestId('browser-stt-model')
			.selectOption(language === 'auto' ? 'base' : 'parakeet');
		await expect(page.getByTestId('browser-stt-confirm')).toBeEnabled();
	}
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(modelRequests).toHaveLength(0);
	await page.getByTestId('browser-stt-toggle').click();
	const legacyExternalRequests = new Set(externalRequests);
	const selectedModel =
		process.env.SPECTRUM_TEST_MODEL ??
		(process.env.SPECTRUM_TEST_WEBGPU === 'true' ? 'base' : undefined);
	if (selectedModel === 'base' || selectedModel === 'parakeet') {
		await page.getByTestId('browser-stt-model').selectOption(selectedModel);
		await expect(page.getByTestId('browser-stt-confirm')).toBeEnabled();
	}
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		const adapter = await page.evaluate(async () => {
			const gpu = (
				navigator as unknown as {
					gpu: { requestAdapter(): Promise<{ info: object; features: Iterable<string> } | null> };
				}
			).gpu;
			const adapter = await gpu.requestAdapter();
			const info = adapter?.info as
				| {
						vendor?: string;
						architecture?: string;
						device?: string;
						description?: string;
						isFallbackAdapter?: boolean;
				  }
				| undefined;
			return (
				adapter && {
					info: {
						vendor: info?.vendor,
						architecture: info?.architecture,
						device: info?.device,
						description: info?.description,
						isFallbackAdapter: info?.isFallbackAdapter
					},
					features: [...adapter.features]
				}
			);
		});
		console.info('HARDWARE ADAPTER:', JSON.stringify(adapter));
	}
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		const gpu = page.getByTestId('browser-stt-webgpu');
		await expect(gpu).toBeVisible();
		await expect(gpu).toBeChecked(); // Prove automatic selection, never force it.
		await expect(page.getByRole('dialog')).toContainText(
			selectedModel === 'parakeet' ? '255 MB' : '290 MB'
		);
	} else {
		// CPU benchmark stays explicit even when local hardware supports GPU.
		const gpu = page.getByTestId('browser-stt-webgpu');
		if (await gpu.isVisible()) await gpu.uncheck();
		await expect(page.getByRole('dialog')).toContainText(
			selectedModel === 'base' || language === 'auto' ? '110 MB' : '225 MB'
		);
	}
	await page.getByTestId('browser-stt-confirm').click();
	const controls = page.getByTestId('browser-stt-controls');
	// Preparation must continue while the audio menu is closed, before capture.
	await page.getByTestId('audio-options').click();
	await Promise.race([
		expect(controls).toHaveAttribute('data-state', 'prepared', { timeout: 120000 }),
		controls
			.getByRole('alert', { includeHidden: true })
			.waitFor({ state: 'attached', timeout: 120000 })
			.then(async () => {
				throw new Error((await controls.textContent()) ?? 'Model preparation failed');
			})
	]);
	expect(publications).toHaveLength(0);
	expect(
		await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
	).toBe(0);
	await expect(page.getByTestId('browser-stt-summary')).toBeVisible();
	await page.getByTestId('audio-options').click();
	await expect(controls).toHaveAttribute('data-state', 'prepared');
	await page.getByTestId('audio-options').click();
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected', {
		timeout: 15000
	});
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
	await Promise.race([
		expect(controls).toHaveAttribute('data-state', 'active', { timeout: 120000 }),
		controls
			.getByRole('alert', { includeHidden: true })
			.waitFor({ state: 'attached', timeout: 120000 })
			.then(async () => {
				throw new Error(await controls.innerText());
			})
	]);
	const transcript = await openTranscript(page);
	if (process.env.SPECTRUM_TEST_SPEECH_ONCE === 'true')
		await page.evaluate(() =>
			(window as unknown as { startPublicSpeech: () => void }).startPublicSpeech()
		);
	if (process.env.SPECTRUM_TEST_WEBGPU === 'true') {
		expect(
			modelRequests.some((url) =>
				new URL(url).pathname.endsWith('ort-wasm-simd-threaded.asyncify.wasm')
			)
		).toBe(true);
		if (selectedModel !== 'parakeet')
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
			.getByRole('alert', { includeHidden: true })
			.waitFor({ state: 'attached', timeout: 60000 })
			.then(async () => {
				// Opening Discussion closes Audio options; capacity errors still
				// exist in its hidden subtree and must not be missed by this probe.
				const message = (await controls.textContent()) ?? '';
				if (browserName === 'firefox' && message.includes('could not keep up'))
					return 'capacity-stop';
				throw new Error(`${message} (published segments: ${publications.length})`);
			})
	]);
	if (process.env.SPECTRUM_TEST_REQUIRE_TRANSCRIPTION === 'true')
		expect(outcome).toBe('transcribed');
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
	if (testGpuInitFail) {
		await expect(page.getByTestId('browser-stt-summary')).toContainText(/switched.*to CPU/);
		const events = await page.evaluate(
			() => (window as unknown as { sttTest: { events: { type: string }[] } }).sttTest.events
		);
		expect(events.filter((event) => event.type === 'sent:load')).toHaveLength(2);
		expect(events).toContainEqual(
			expect.objectContaining({ worker: 0, type: 'error', reason: 'gpu' })
		);
		expect(events).toContainEqual(
			expect.objectContaining({ worker: 1, type: 'ready', backend: 'wasm' })
		);
		console.info(
			'GPU INITIALIZATION FAILURE: one CPU fallback, real CPU captions, one voice capture.'
		);
	}
	if (gpuCancel) {
		const before = publications.length;
		if (gpuCancel === 'stop') {
			await page.getByTestId('audio-options').click();
			await page.getByTestId('browser-stt-toggle').click();
		} else if (gpuCancel === 'mute') {
			await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
			await expect(controls).toHaveAttribute('data-state', 'prepared');
		} else if (gpuCancel === 'room') {
			await page.getByLabel('Room options', { exact: true }).click();
			await page
				.getByLabel('Transcription language (restarts audio)', { exact: true })
				.selectOption('en');
			await page.getByLabel('Room options', { exact: true }).click();
		} else throw new Error('Unknown GPU cancellation scenario');
		if (gpuCancel === 'room')
			await expect
				.poll(() =>
					page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
				)
				.toBe(2);
		const capturesAfterCancel = await page.evaluate(
			() => (window as unknown as { captureCalls: number }).captureCalls
		);
		await page.evaluate(() =>
			(window as unknown as { sttTest: { workers: Worker[] } }).sttTest.workers[0].postMessage({
				type: '__test_destroy_gpu'
			})
		);
		if (gpuCancel === 'mute') {
			// Microphone loss preserves preparation, but never re-admits capture.
			await expect(page.getByTestId('browser-stt-summary')).toContainText(/switched.*to CPU/);
			await expect(controls).toHaveAttribute('data-state', 'prepared', { timeout: 120000 });
			expect(starts).toHaveLength(1);
			await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'false');
		} else await expect(controls).toHaveAttribute('data-state', 'off');
		await page.waitForTimeout(2000);
		const events = await page.evaluate(
			() => (window as unknown as { sttTest: { events: { type: string }[] } }).sttTest.events
		);
		expect(events.filter((event) => event.type === 'sent:load')).toHaveLength(
			gpuCancel === 'mute' ? 2 : 1
		);
		expect(publications).toHaveLength(before);
		expect(
			await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
		).toBe(capturesAfterCancel);
		console.info(
			`CANCELLATION ${gpuCancel}: no new caption admission/publication or fallback voice capture; ${gpuCancel === 'mute' ? 'CPU preparation only' : 'no CPU retry'}. Voice captures after action: ${capturesAfterCancel}${gpuCancel === 'room' ? ' (room language intentionally restarts voice)' : ''}.`
		);
		return;
	}
	if (testGpuLoss) {
		const before = publications.length;
		expect(starts).toHaveLength(1);
		const weightsBefore = modelRequests.filter((url) => /\.onnx(?:\?|$)/.test(url));
		if (selectedModel === 'base')
			expect(weightsBefore.some((url) => url.includes('_quantized.onnx'))).toBe(false);
		await page.evaluate(() => {
			const state = (window as unknown as { sttTest: { workers: Worker[] } }).sttTest;
			state.workers[0].postMessage({ type: '__test_destroy_gpu' });
		});
		try {
			await expect(page.getByTestId('browser-stt-summary')).toContainText(/switched.*to CPU/, {
				timeout: 35000
			});
		} catch (error) {
			console.info(
				'DEVICE LOSS FAILURE:',
				JSON.stringify(
					await page.evaluate(
						() => (window as unknown as { sttTest: { events: unknown[] } }).sttTest.events
					)
				),
				await controls.textContent()
			);
			throw error;
		}
		await expect(controls).toHaveAttribute('data-state', 'active', { timeout: 120000 });
		expect(starts).toHaveLength(2);
		expect(starts[1].requestId).not.toBe(starts[0].requestId);
		await page.getByTestId('audio-options').click();
		await expect(controls.getByRole('status')).toContainText('CPU');
		await expect(controls.getByRole('status')).not.toContainText('WebGPU');
		await expect(page.getByTestId('browser-stt-fallback')).toContainText('not replayed');
		const events = await page.evaluate(
			() => (window as unknown as { sttTest: { events: unknown[] } }).sttTest.events
		);
		console.info('DEVICE LOSS EVENTS:', JSON.stringify(events));
		expect(events.filter((event) => (event as { type: string }).type === 'sent:load')).toHaveLength(
			2
		);
		expect(events).toContainEqual(
			expect.objectContaining({ worker: 0, type: '__test_device_destroyed', count: 1 })
		);
		expect(events).toContainEqual(expect.objectContaining({ worker: 0, type: 'terminated' }));
		expect(events).toContainEqual(
			expect.objectContaining({ worker: 1, type: 'ready', backend: 'wasm' })
		);
		if (selectedModel === 'parakeet')
			expect(modelRequests.filter((url) => /\.onnx(?:\?|$)/.test(url))).toEqual(weightsBefore);
		else expect(modelRequests.some((url) => url.includes('_quantized.onnx'))).toBe(true);
		expect(
			await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
		).toBe(1);
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		await page.waitForTimeout(1000);
		expect(publications.length).toBe(before); // Failed phrase is not silently replayed.
		await page.evaluate(() =>
			(window as unknown as { startPublicSpeech(): void }).startPublicSpeech()
		);
		await expect.poll(() => publications.length, { timeout: 60000 }).toBeGreaterThan(before);
		expect((publications[before] as { sessionId: string }).sessionId).not.toBe(
			(publications[0] as { sessionId: string }).sessionId
		);
		console.info(
			'CPU FALLBACK: new speech transcribed; GPU speech not replayed; voice capture unchanged.'
		);
	}
	// Stop before opening another browser: slower devices may exhaust their
	// bounded queue while that browser starts. History must survive either stop.
	if ((await controls.getAttribute('data-state')) !== 'off') {
		if (!(await page.getByTestId('browser-stt-toggle').isVisible()))
			await page.getByTestId('audio-options').click();
		await page.getByTestId('browser-stt-toggle').click();
	} else {
		expect(browserName).toBe('firefox');
		await expect(controls.getByRole('alert', { includeHidden: true })).toContainText(
			'could not keep up'
		);
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
		await expect(page.getByTestId('browser-stt-toggle')).toBeEnabled();
	} finally {
		await context.close();
	}
});
