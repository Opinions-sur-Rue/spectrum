import { expect, test, type BrowserContext } from '@playwright/test';

declare global {
	interface Window {
		__voiceFixture: { calls: number; tracks: MediaStreamTrack[] };
	}
}

async function syntheticMicrophone(context: BrowserContext) {
	await context.addInitScript(() => {
		window.__voiceFixture = { calls: 0, tracks: [] };
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			if (constraints?.video) throw new Error('Camera capture is forbidden in audio tests');
			window.__voiceFixture.calls++;
			const audio = new AudioContext();
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			const destination = audio.createMediaStreamDestination();
			gain.gain.value = 0.01;
			oscillator.frequency.value = 440;
			oscillator.connect(gain).connect(destination);
			oscillator.start();
			await audio.resume();
			for (const track of destination.stream.getTracks()) {
				window.__voiceFixture.tracks.push(track);
				const stop = track.stop.bind(track);
				let ended = false;
				track.stop = () => {
					if (!ended) {
						ended = true;
						stop();
						oscillator.stop();
						void audio.close();
					}
				};
			}
			return destination.stream;
		};
	});
}

test('self-hosted voice: consent, spectator listening, live audio, and cached-token revocation', async ({
	page,
	browser
}) => {
	const errors: string[] = [];
	await syntheticMicrophone(page.context());
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/v2');
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await expect(page.getByRole('button', { name: 'Join audio', exact: true })).toBeVisible();
	const actorContext = await browser.newContext();
	const listenerContext = await browser.newContext();
	await syntheticMicrophone(actorContext);
	await syntheticMicrophone(listenerContext);
	try {
		const actor = await actorContext.newPage();
		const listener = await listenerContext.newPage();
		let publisherToken = '';
		actor.on('websocket', (socket) => {
			if (!socket.url().includes('/spectrum/ws')) return;
			socket.on('framereceived', ({ payload }) => {
				for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
					const event = JSON.parse(line);
					if (event.op === 'voice.credentials' && event.payload.canPublish)
						publisherToken = event.payload.token;
				}
			});
		});
		for (const client of [actor, listener]) {
			client.on('pageerror', (error) => errors.push(error.message));
			await client.goto(page.url());
			await expect(client.getByTestId('own-role')).toHaveText('spectator');
			await client.getByRole('button', { name: 'Join audio', exact: true }).click();
			await expect(client.getByTestId('voice-controls')).toHaveAttribute(
				'data-status',
				'connected',
				{ timeout: 30000 }
			);
			expect(await client.evaluate(() => window.__voiceFixture.calls)).toBe(0);
			await expect(
				client.getByRole('button', { name: 'Enable microphone', exact: true })
			).toHaveCount(0);
		}
		await page.getByRole('button', { name: 'Join audio', exact: true }).click();
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected', {
			timeout: 30000
		});
		expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(0);
		await actor.getByLabel('People', { exact: true }).click();
		await actor.getByLabel('Your pseudonym').fill('Speaker');
		await actor.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
		await actor.getByLabel('People', { exact: true }).click();
		await page.getByLabel('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Promote Speaker', exact: true }).click();
		await page.getByLabel('People', { exact: true }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await expect(actor.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled(
			{ timeout: 30000 }
		);
		expect(await actor.evaluate(() => window.__voiceFixture.calls)).toBe(0);
		await actor.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		await expect(page.getByTestId('voice-controls')).toHaveAttribute('data-remote-tracks', '1', {
			timeout: 30000
		});
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute(
			'data-remote-tracks',
			'1',
			{ timeout: 30000 }
		);
		await expect
			.poll(
				async () =>
					listener
						.locator('[data-voice-audio]')
						.first()
						.evaluate((element) => (element as HTMLAudioElement).currentTime),
				{ timeout: 15000 }
			)
			.toBeGreaterThan(0);
		const captures = await actor.evaluate(() => window.__voiceFixture.calls);
		expect(captures).toBeGreaterThan(0);
		expect(publisherToken).toBeTruthy();
		const claims = JSON.parse(Buffer.from(publisherToken.split('.')[1], 'base64url').toString());
		expect(claims.video.canPublish).toBe(true);
		expect(claims.video.canPublishData).toBe(false);
		expect(claims.video.canPublishSources).toEqual(['microphone']);
		await page.getByLabel('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Demote Speaker', exact: true }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await expect(actor.getByRole('button', { name: 'Enable microphone', exact: true })).toHaveCount(
			0
		);
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'false');
		await expect
			.poll(async () =>
				actor.evaluate(() =>
					window.__voiceFixture.tracks.every((track) => track.readyState === 'ended')
				)
			)
			.toBe(true);
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute(
			'data-status',
			'connected',
			{ timeout: 30000 }
		);
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute('data-remote-tracks', '0');
		expect(claims.exp * 1000).toBeGreaterThan(Date.now());
		const stale = await page.request.get('http://127.0.0.1:7880/rtc/validate?protocol=16', {
			headers: { Authorization: `Bearer ${publisherToken}` }
		});
		expect(stale.status()).toBe(404);
		await page.getByRole('button', { name: 'Promote Speaker', exact: true }).click();
		await page.getByLabel('People', { exact: true }).click();
		await expect(actor.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled(
			{ timeout: 30000 }
		);
		expect(await actor.evaluate(() => window.__voiceFixture.calls)).toBe(captures);
		await actor.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute(
			'data-remote-tracks',
			'1',
			{ timeout: 30000 }
		);
		await actor.getByRole('button', { name: 'Mute microphone', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'false');
		await expect
			.poll(async () =>
				actor.evaluate(() =>
					window.__voiceFixture.tracks.every((track) => track.readyState === 'ended')
				)
			)
			.toBe(true);
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute('data-remote-tracks', '0');
		expect(errors).toEqual([]);
	} finally {
		await actorContext.close();
		await listenerContext.close();
	}
});
