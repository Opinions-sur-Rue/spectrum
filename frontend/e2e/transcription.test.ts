import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { englishLocale } from './locale-state';
import { openTranscript } from './discussion';

test('real CPU ASR transcribes a solo speaker, then shares history with spectators', async ({
	page,
	browser
}) => {
	test.skip(
		!process.env.SPECTRUM_TEST_SPEECH,
		'Set SPECTRUM_TEST_SPEECH to a local English speech WAV (e.g. whisper.cpp samples/jfk.wav).'
	);
	const wav = readFileSync(process.env.SPECTRUM_TEST_SPEECH!);
	let firstDraftAt = 0;
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/spectrum/ws')) return;
		socket.on('framereceived', ({ payload }) => {
			for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
				const event = JSON.parse(line);
				if (
					!firstDraftAt &&
					event.op === 'transcript.segment' &&
					!event.payload.final &&
					event.payload.text
				)
					firstDraftAt = Date.now();
			}
		});
	});
	await page.route('**/stt-test.wav', (route) =>
		route.fulfill({ contentType: 'audio/wav', body: wav })
	);
	await page.addInitScript(() => {
		(window as unknown as { captureCalls: number }).captureCalls = 0;
		navigator.mediaDevices.getUserMedia = async () => {
			(window as unknown as { captureCalls: number }).captureCalls++;
			const context = new AudioContext();
			const source = context.createBufferSource();
			source.buffer = await context.decodeAudioData(
				await (await fetch('/stt-test.wav')).arrayBuffer()
			);
			const destination = context.createMediaStreamDestination();
			source.connect(destination);
			await context.resume();
			source.start(context.currentTime + 3);
			for (const track of destination.stream.getTracks()) {
				const stop = track.stop.bind(track);
				let stopped = false;
				track.stop = () => {
					if (stopped) return;
					stopped = true;
					stop();
					void context.close();
				};
			}
			return destination.stream;
		};
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByLabel('Room options', { exact: true }).click();
	const language = page.getByLabel('Transcription language (restarts audio)', { exact: true });
	await expect(language).toHaveValue('fr');
	await language.selectOption(process.env.SPECTRUM_TEST_LANGUAGE ?? 'en');
	await page.getByLabel('Room options', { exact: true }).click();
	await openTranscript(page);
	await expect(page.getByRole('region', { name: 'Room transcript' })).toContainText(
		'Local transcription ready',
		{ timeout: 30000 }
	);
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected');
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	expect(
		await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
	).toBe(0);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(
		await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
	).toBe(0);
	const spectatorContext = await browser.newContext({ storageState: englishLocale });
	try {
		await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await page
			.getByRole('button', { name: 'Accept and enable my microphone', exact: true })
			.click();
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true', {
			timeout: 15000
		});
		const microphoneReadyAt = Date.now();
		// No other app client has connected yet: the speaker must see their own
		// transcript, without a second human or an audio listener in the room.
		const log = await openTranscript(page);
		await expect(
			log
				.locator('[data-transcript-final="true"]')
				.filter({
					hasText: new RegExp(process.env.SPECTRUM_TEST_EXPECT ?? 'country|americans', 'i')
				})
				.first()
		).toBeVisible({ timeout: 60000 });
		if (firstDraftAt)
			console.info(
				'Fixture first draft after speech starts (approx ms):',
				firstDraftAt - microphoneReadyAt - 3000
			);
		const spectator = await spectatorContext.newPage();
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await openTranscript(spectator);
		await expect(spectator.getByRole('log', { name: 'Transcript segments' })).toContainText(
			new RegExp(process.env.SPECTRUM_TEST_EXPECT ?? 'country|americans', 'i')
		);
		await page.getByLabel('Room options', { exact: true }).click();
		const transcription = page.getByRole('checkbox', { name: 'Local transcription' });
		await transcription.uncheck();
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'false');
		const captures = await page.evaluate(
			() => (window as unknown as { captureCalls: number }).captureCalls
		);
		await transcription.check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({
			timeout: 15000
		});
		await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		expect(
			await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
		).toBe(captures);
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(
			await page.evaluate(() => (window as unknown as { captureCalls: number }).captureCalls)
		).toBeGreaterThan(0);
	} finally {
		await spectatorContext.close();
	}
});
