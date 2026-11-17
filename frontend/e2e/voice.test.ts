import { expect, type BrowserContext, type Page } from '@playwright/test';
import { newRoomContext, test } from './network-assets';
import { englishLocale } from './locale-state';

declare global {
	interface Window {
		__voiceFixture: {
			calls: number;
			tracks: MediaStreamTrack[];
			deny: boolean;
			delay: boolean;
			resumeCapture: (() => void) | null;
			appSockets: WebSocket[];
			voiceSockets: WebSocket[];
		};
	}
}

async function syntheticMicrophone(context: BrowserContext) {
	await context.addInitScript(() => {
		window.__voiceFixture = {
			calls: 0,
			tracks: [],
			deny: false,
			delay: false,
			resumeCapture: null,
			appSockets: [],
			voiceSockets: []
		};
		window.WebSocket = new Proxy(window.WebSocket, {
			construct(target, args) {
				const socket = Reflect.construct(target, args) as WebSocket;
				if (socket.url.includes('/spectrum/ws')) window.__voiceFixture.appSockets.push(socket);
				else if (socket.url.includes('/rtc')) window.__voiceFixture.voiceSockets.push(socket);
				return socket;
			}
		});
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			if (constraints?.video) throw new Error('Camera capture is forbidden in audio tests');
			window.__voiceFixture.calls++;
			if (window.__voiceFixture.deny)
				throw new DOMException('Permission denied', 'NotAllowedError');
			if (window.__voiceFixture.delay)
				await new Promise<void>((resolve) => {
					window.__voiceFixture.resumeCapture = () => {
						window.__voiceFixture.resumeCapture = null;
						resolve();
					};
				});
			const audio = new AudioContext();
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			const destination = audio.createMediaStreamDestination();
			gain.gain.value = 0.15;
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

test('push-to-talk holds only while pressed, never hijacks typing, and cancels late microphone permission', async ({
	page
}) => {
	await syntheticMicrophone(page.context());
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.getByTestId('mic-options').click();
	await page.getByTestId('push-to-talk-mode').check();
	await page.getByTestId('mic-options').click();
	const hold = page.getByTestId('push-to-talk');
	await expect(hold).toBeEnabled();
	expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(0);
	await hold.focus();
	await page.keyboard.down('Space');
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await page.keyboard.down('Space');
	expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(1);
	await page.keyboard.up('Space');
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__voiceFixture.tracks.every((track) => track.readyState === 'ended')
			)
		)
		.toBe(true);
	await page.getByTestId('discussion-toggle').click();
	await page.getByTestId('discussion-tab-chat').click();
	const input = page.getByTestId('discussion-panel').locator('textarea');
	await input.fill('Typing');
	await input.press('End');
	await input.press('Space');
	await expect(input).toHaveValue('Typing ');
	expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(1);
	await page.getByTestId('discussion-close').click();
	const point = (await hold.boundingBox())!;
	await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
	await page.mouse.down();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	await page.mouse.up();
	await hold.focus();
	await page.keyboard.down('Space');
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await page.evaluate(() => window.__voiceFixture.appSockets.at(-1)!.close());
	await expect(page.getByTestId('connection-state')).toHaveAttribute('data-status', 'Reconnecting');
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	await page.keyboard.up('Space');
	await expect(page.getByTestId('connection-state')).toHaveAttribute('data-status', 'Connected', {
		timeout: 15000
	});
	await expect(hold).toHaveAttribute('aria-pressed', 'false');
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	const captures = await page.evaluate(() => window.__voiceFixture.calls);
	const tracks = await page.evaluate(() => window.__voiceFixture.tracks.length);
	await page.evaluate(() => {
		window.__voiceFixture.delay = true;
	});
	await hold.focus();
	await page.keyboard.down('Space');
	await expect.poll(() => page.evaluate(() => window.__voiceFixture.calls)).toBe(captures + 1);
	await page.keyboard.up('Space');
	await page.evaluate(() => window.__voiceFixture.resumeCapture?.());
	await expect
		.poll(() => page.evaluate(() => window.__voiceFixture.tracks.length))
		.toBe(tracks + 1);
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__voiceFixture.tracks.every((track) => track.readyState === 'ended')
			)
		)
		.toBe(true);
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	await page.getByTestId('mic-options').click();
	await page.getByTestId('push-to-talk-mode').uncheck();
	await page.getByTestId('mic-options').click();
	await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeVisible();
});

test('push-to-talk remains usable in a small French mobile viewport', async ({ page }) => {
	await syntheticMicrophone(page.context());
	await page
		.context()
		.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'fr', domain: 'localhost', path: '/' }]);
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveAttribute('data-role', 'admin');
	await page.getByTestId('audio-toggle').click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.getByTestId('mic-options').click();
	await page.getByTestId('push-to-talk-mode').check();
	await page.getByTestId('mic-options').click();
	const hold = page.getByTestId('push-to-talk');
	await expect(hold).toBeEnabled();
	const box = (await hold.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(568);
	expect(box.x + box.width).toBeLessThanOrEqual(320);
	await page.screenshot({ path: test.info().outputPath('push-to-talk-fr-mobile.png') });
	expect((await page.getByTestId('canvas-viewport').boundingBox())!.height).toBeGreaterThan(80);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await page.mouse.up();
	await expect(controls).toHaveAttribute('data-microphone', 'false');
});

test('voice survives app reconnect and another member leaving; active mic returns after SFU retirement', async ({
	page,
	browser
}) => {
	await syntheticMicrophone(page.context());
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	const captures = await page.evaluate(() => window.__voiceFixture.calls);
	await page.evaluate(() => window.__voiceFixture.appSockets.at(-1)!.close());
	await expect(page.getByTestId('connection-state')).toHaveAttribute('data-status', 'Reconnecting');
	await expect(controls).toHaveAttribute('data-status', 'connected');
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await expect(page.getByTestId('connection-state')).toHaveAttribute('data-status', 'Connected', {
		timeout: 15000
	});
	expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(captures);

	const listenerContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(listenerContext);
	try {
		const listener = await listenerContext.newPage();
		await listener.goto(page.url());
		await expect(listener.getByTestId('own-role')).toHaveText('spectator');
		await listener.getByRole('button', { name: 'Join audio', exact: true }).click();
		await expect(listener.getByTestId('voice-controls')).toHaveAttribute(
			'data-remote-tracks',
			'1',
			{ timeout: 30000 }
		);
		await listener.evaluate(() =>
			window.__voiceFixture.appSockets
				.at(-1)!
				.send(JSON.stringify({ v: 2, op: 'room.leave', payload: {} }))
		);
		await expect(listener.getByTestId('voice-controls')).toHaveCount(0);
		await expect(controls).toHaveAttribute('data-status', 'connected');
		await expect(controls).toHaveAttribute('data-microphone', 'true');
		expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(captures);
	} finally {
		await listenerContext.close();
	}
	// Even with transcription disabled, changing its language retires the SFU
	// room. This exercises a real involuntary full rejoin with a fresh grant.
	await page.evaluate(() =>
		window.__voiceFixture.appSockets
			.at(-1)!
			.send(JSON.stringify({ v: 2, op: 'room.settings', payload: { transcriptionLanguage: 'en' } }))
	);
	await expect
		.poll(() => page.evaluate(() => window.__voiceFixture.calls), { timeout: 30000 })
		.toBeGreaterThan(captures);
	await expect(controls).toHaveAttribute('data-status', 'connected');
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
});

test('successful microphone retry clears the obsolete permission alert', async ({ page }) => {
	await syntheticMicrophone(page.context());
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByLabel('Room options', { exact: true }).click();
	const transcription = page.getByRole('checkbox', { name: 'Local transcription' });
	if (await transcription.isVisible()) await transcription.uncheck();
	await page.getByLabel('Room options', { exact: true }).click();
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.evaluate(() => (window.__voiceFixture.deny = true));
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(controls.getByRole('alert')).toBeVisible();
	await expect(controls).toHaveAttribute('data-microphone', 'false');
	await page.evaluate(() => (window.__voiceFixture.deny = false));
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	await expect(controls.getByRole('alert')).toHaveCount(0);
	await expect(page.getByTestId('voice-summary')).toHaveText('Microphone on');
	await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
});

test('promotion, demotion and kick never reconnect other voice participants', async ({
	page,
	browser
}) => {
	await syntheticMicrophone(page.context());
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	const baseline = await page.evaluate(() => ({
		captures: window.__voiceFixture.calls,
		connections: window.__voiceFixture.voiceSockets.length
	}));
	const actorContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(actorContext);
	try {
		const actor = await actorContext.newPage();
		let token = '',
			signalURL = '';
		actor.on('websocket', (socket) => {
			if (!socket.url().includes('/spectrum/ws')) return;
			socket.on('framereceived', ({ payload }) => {
				for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
					const event = JSON.parse(line);
					if (event.op === 'voice.credentials') {
						token = event.payload.token;
						signalURL = event.payload.url;
					}
				}
			});
		});
		await actor.goto(page.url());
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await actor.getByRole('button', { name: 'Join audio', exact: true }).click();
		const actorControls = actor.getByTestId('voice-controls');
		await expect(actorControls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
		const actorConnections = await actor.evaluate(() => window.__voiceFixture.voiceSockets.length);
		await page.getByLabel('People', { exact: true }).click();
		for (let cycle = 0; cycle < 2; cycle++) {
			await page.getByRole('button', { name: /^Promote / }).click();
			await expect(actor.getByTestId('own-role')).toHaveText('participant');
			await expect(actorControls).toHaveAttribute('data-microphone', 'false');
			await actor.getByRole('button', { name: 'Enable microphone', exact: true }).click();
			await expect(controls).toHaveAttribute('data-remote-tracks', '1', { timeout: 30000 });
			await page.getByRole('button', { name: /^Demote / }).click();
			await expect(actor.getByTestId('own-role')).toHaveText('spectator');
			await expect(actorControls).toHaveAttribute('data-status', 'connected');
			await expect(actorControls).toHaveAttribute('data-microphone', 'false');
			await expect(controls).toHaveAttribute('data-remote-tracks', '0');
			expect(await actor.evaluate(() => window.__voiceFixture.voiceSockets.length)).toBe(
				actorConnections
			);
		}
		// The old membership epoch is rejected even if a modified client replays it.
		const validationURL = signalURL.replace(/^ws/, 'http') + '/rtc/validate?protocol=16';
		expect(
			(
				await page.request.get(validationURL, { headers: { Authorization: `Bearer ${token}` } })
			).status()
		).toBe(403);
		const memberID = await page
			.locator('[data-member-id]')
			.filter({ has: page.getByRole('button', { name: /^Promote / }) })
			.getAttribute('data-member-id');
		await page.evaluate(
			(memberId) =>
				window.__voiceFixture.appSockets
					.at(-1)!
					.send(JSON.stringify({ v: 2, op: 'room.kick', payload: { memberId } })),
			memberID
		);
		await expect(actorControls).toHaveCount(0);
		expect(
			(
				await page.request.get(validationURL, { headers: { Authorization: `Bearer ${token}` } })
			).status()
		).toBe(403);
		await expect(controls).toHaveAttribute('data-status', 'connected');
		await expect(controls).toHaveAttribute('data-microphone', 'true');
		expect(
			await page.evaluate(() => ({
				captures: window.__voiceFixture.calls,
				connections: window.__voiceFixture.voiceSockets.length
			}))
		).toEqual(baseline);
		expect(
			await page.evaluate(() =>
				window.__voiceFixture.tracks.every((track) => track.readyState === 'live')
			)
		).toBe(true);
	} finally {
		await actorContext.close();
	}
});

test('admin mute targets one microphone; only its owner resumes, and hold mode requires a fresh press', async ({
	page: admin,
	browser
}) => {
	await syntheticMicrophone(admin.context());
	await admin.goto('/v2');
	await admin.getByTestId('create-room').click();
	await expect(admin.getByTestId('own-role')).toHaveText('admin');
	const actorContext = await newRoomContext(browser, { storageState: englishLocale });
	const listenerContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(actorContext);
	await syntheticMicrophone(listenerContext);
	async function send(client: Page, op: string, payload: unknown = {}) {
		await client.evaluate(
			({ op, payload }) =>
				window.__voiceFixture.appSockets.at(-1)!.send(JSON.stringify({ v: 2, op, payload })),
			{ op, payload }
		);
	}
	async function baseline(client: Page) {
		return client.evaluate(() => ({
			captures: window.__voiceFixture.calls,
			connections: window.__voiceFixture.voiceSockets.length
		}));
	}
	try {
		const actor = await actorContext.newPage();
		const listener = await listenerContext.newPage();
		const grants: { token: string; url: string; requestId: string; canPublish: boolean }[] = [];
		actor.on('websocket', (socket) => {
			if (socket.url().includes('/spectrum/ws'))
				socket.on('framereceived', ({ payload }) => {
					for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
						const event = JSON.parse(line);
						if (event.op === 'voice.credentials') grants.push(event.payload);
					}
				});
		});
		for (const client of [actor, listener]) {
			await client.goto(admin.url());
			await expect(client.getByTestId('own-role')).toHaveText('spectator');
		}
		await send(actor, 'room.profile', { nickname: 'Noisy' });
		await expect(actor.getByTestId('edit-pseudonym')).toContainText('Noisy');
		await admin.getByLabel('People', { exact: true }).click();
		await admin.getByRole('button', { name: 'Promote Noisy', exact: true }).click();
		await admin.getByLabel('People', { exact: true }).click();
		for (const client of [admin, actor, listener]) {
			await client.getByTestId('audio-toggle').click();
			await expect(client.getByTestId('voice-controls')).toHaveAttribute(
				'data-status',
				'connected',
				{ timeout: 30000 }
			);
		}
		for (const client of [admin, actor]) {
			await client.getByRole('button', { name: 'Enable microphone', exact: true }).click();
			await expect(client.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		}
		const actorControls = actor.getByTestId('voice-controls');
		const listenerControls = listener.getByTestId('voice-controls');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '2', { timeout: 30000 });
		const adminBaseline = await baseline(admin),
			listenerBaseline = await baseline(listener),
			actorBaseline = await baseline(actor);
		const old = grants.find((grant) => grant.canPublish)!;
		expect(old).toBeTruthy();
		const validationURL = old.url.replace(/^ws/, 'http') + '/rtc/validate?protocol=16';
		await admin.getByLabel('People', { exact: true }).click();
		const mute = admin.getByRole('button', { name: "Mute Noisy's microphone", exact: true });
		await mute.click();
		await expect(mute).toBeDisabled();
		await expect(actorControls).toHaveAttribute('data-microphone', 'false');
		await expect(actorControls).toHaveAttribute('data-status', 'connected');
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '1');
		await expect(admin.getByRole('slider', { name: 'Volume for Noisy', exact: true })).toHaveValue(
			'1'
		);
		expect(await baseline(actor)).toEqual(actorBaseline);
		expect(
			(
				await actor.request.get(validationURL, {
					headers: { Authorization: 'Bearer ' + old.token }
				})
			).status()
		).toBe(403);
		await send(actor, 'voice.join', { requestId: 'probe-muted-grant', transcriptionConsent: true });
		await expect
			.poll(() => grants.find((grant) => grant.requestId === 'probe-muted-grant')?.canPublish)
			.toBe(false);
		await actor.evaluate(() => window.__voiceFixture.appSockets.at(-1)!.close());
		await expect(actor.getByTestId('connection-state')).toHaveAttribute(
			'data-status',
			'Reconnecting'
		);
		await expect(actor.getByTestId('connection-state')).toHaveAttribute(
			'data-status',
			'Connected',
			{ timeout: 15000 }
		);
		await expect(actorControls).toHaveAttribute('data-microphone', 'false');
		await actor.getByRole('button', { name: 'Re-enable my microphone', exact: true }).click();
		await expect(actorControls).toHaveAttribute('data-microphone', 'true', { timeout: 15000 });
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '2', { timeout: 15000 });
		await expect(mute).toBeEnabled();
		expect(
			(
				await actor.request.get(validationURL, {
					headers: { Authorization: 'Bearer ' + old.token }
				})
			).status()
		).toBe(403);
		await actor.getByTestId('mic-options').click();
		await actor.getByTestId('push-to-talk-mode').check();
		await actor.getByTestId('mic-options').click();
		const hold = actor.getByTestId('push-to-talk');
		await hold.focus();
		await actor.keyboard.down('Space');
		await expect(actorControls).toHaveAttribute('data-microphone', 'true');
		// Background-page evaluate avoids blurring the held button before the
		// server moderation event, so this specifically exercises forced release.
		await admin.evaluate(() => {
			const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
				(node) => node.getAttribute('aria-label') === "Mute Noisy's microphone"
			);
			button!.click();
		});
		await expect(actorControls).toHaveAttribute('data-microphone', 'false');
		await expect(hold).toHaveAttribute('aria-pressed', 'false');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '1');
		await actor.getByRole('button', { name: 'Re-enable my microphone', exact: true }).click();
		await expect(hold).toBeEnabled({ timeout: 15000 });
		await expect(actorControls).toHaveAttribute('data-microphone', 'false');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '1');
		await actor.keyboard.up('Space');
		await hold.focus();
		await actor.keyboard.down('Space');
		await expect(actorControls).toHaveAttribute('data-microphone', 'true');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '2');
		await actor.keyboard.up('Space');
		await expect(listenerControls).toHaveAttribute('data-remote-tracks', '1');
		expect(await baseline(admin)).toEqual(adminBaseline);
		expect(await baseline(listener)).toEqual(listenerBaseline);
		await expect(admin.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
	} finally {
		await actorContext.close();
		await listenerContext.close();
	}
});

test('speaking time is attributed to the member who spoke and shared live', async ({
	page: admin,
	browser
}) => {
	await admin.goto('/v2');
	await admin.getByTestId('create-room').click();
	await expect(admin.getByTestId('own-role')).toHaveText('admin');
	const actorContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(actorContext);
	const openPeople = async (client: Page) => {
		const panel = client.getByTestId('people-panel');
		if (!(await panel.isVisible())) await client.getByLabel('People', { exact: true }).click();
		await expect(panel).toBeVisible();
	};
	try {
		const actor = await actorContext.newPage();
		await actor.goto(admin.url());
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await actor.evaluate(() =>
			window.__voiceFixture.appSockets
				.at(-1)!
				.send(JSON.stringify({ v: 2, op: 'room.profile', payload: { nickname: 'Speaker' } }))
		);
		await expect(actor.getByTestId('edit-pseudonym')).toContainText('Speaker');
		await openPeople(admin);
		await admin.getByRole('button', { name: 'Promote Speaker', exact: true }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await openPeople(admin);
		const row = admin.locator('[data-member-id]').filter({ hasText: 'Speaker' });
		const memberId = await row.getAttribute('data-member-id');
		expect(memberId).toBeTruthy();
		await actor.evaluate(() =>
			window.__voiceFixture.appSockets
				.at(-1)!
				.send(JSON.stringify({ v: 2, op: 'voice.speaking', payload: { speaking: true } }))
		);
		await actor.waitForTimeout(1200);
		await actor.evaluate(() =>
			window.__voiceFixture.appSockets
				.at(-1)!
				.send(JSON.stringify({ v: 2, op: 'voice.speaking', payload: { speaking: false } }))
		);
		await expect(admin.locator(`[data-speaking-time="${memberId}"]`)).toHaveText(/^[1-9]\d* s$/);
		await expect(row.locator(`[data-speaking-time="${memberId}"]`)).toBeVisible();
		const own = admin.locator('[data-member-id]').filter({ hasText: '(you)' });
		await expect(own.locator('[data-speaking-time]')).toHaveCount(0);
		// The same counter must also grow from real microphone activity, which is
		// reported by the client rather than driven through the socket here.
		const seconds = async () => {
			const text = (await admin.locator(`[data-speaking-time="${memberId}"]`).textContent()) ?? '';
			const parts = /(?:(\d+) min)? ?(\d+) s/.exec(text);
			return parts ? Number(parts[1] ?? 0) * 60 + Number(parts[2]) : 0;
		};
		const before = await seconds();
		await actor.getByRole('button', { name: 'Join audio', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected', {
			timeout: 30000
		});
		await actor.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'true');
		await actor.waitForTimeout(2500);
		await actor.getByRole('button', { name: 'Mute microphone', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-microphone', 'false');
		await expect.poll(seconds, { timeout: 20000 }).toBeGreaterThan(before);
	} finally {
		await actorContext.close();
	}
});

test('an expired speaker does not disconnect the remaining microphone', async ({
	page,
	browser
}) => {
	await syntheticMicrophone(page.context());
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByRole('button', { name: 'Join audio', exact: true }).click();
	const controls = page.getByTestId('voice-controls');
	await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
	await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
	await expect(controls).toHaveAttribute('data-microphone', 'true');
	const captures = await page.evaluate(() => window.__voiceFixture.calls);
	const actorContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(actorContext);
	try {
		const actor = await actorContext.newPage();
		await actor.goto(page.url());
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await page.getByLabel('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Promote / }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await actor.getByRole('button', { name: 'Join audio', exact: true }).click();
		await expect(actor.getByTestId('voice-controls')).toHaveAttribute('data-status', 'connected', {
			timeout: 30000
		});
		await actor.getByRole('button', { name: 'Enable microphone', exact: true }).click();
		await expect(controls).toHaveAttribute('data-remote-tracks', '1', { timeout: 30000 });
		await expect(page.locator('[data-member-id]')).toHaveCount(2);
		// Close without room.leave: membership expires through the cleanup path.
		await actorContext.close();
		await expect(page.locator('[data-member-id]')).toHaveCount(1, { timeout: 100000 });
		// Both participants hold two-minute SFU tokens, so a legitimate token
		// refresh window can overlap this check. Microphone continuity is proven
		// below by the unchanged capture count and live tracks.
		await expect(controls).toHaveAttribute('data-status', 'connected', { timeout: 30000 });
		await expect(controls).toHaveAttribute('data-microphone', 'true', { timeout: 30000 });
		expect(await page.evaluate(() => window.__voiceFixture.calls)).toBe(captures);
		expect(
			await page.evaluate(() =>
				window.__voiceFixture.tracks.every((track) => track.readyState === 'live')
			)
		).toBe(true);
	} finally {
		await actorContext.close();
	}
});

test('self-hosted voice: consent, spectator listening, live audio, and cached-token revocation', async ({
	page,
	browser
}) => {
	const errors: string[] = [];
	await syntheticMicrophone(page.context());
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByLabel('Room options', { exact: true }).click();
	const transcription = page.getByRole('checkbox', { name: 'Local transcription' });
	if (await transcription.isVisible()) await transcription.uncheck();
	await page.getByLabel('Room options', { exact: true }).click();
	await expect(page.getByRole('button', { name: 'Join audio', exact: true })).toBeVisible();
	const actorContext = await newRoomContext(browser, { storageState: englishLocale });
	const listenerContext = await newRoomContext(browser, { storageState: englishLocale });
	await syntheticMicrophone(actorContext);
	await syntheticMicrophone(listenerContext);
	try {
		const actor = await actorContext.newPage();
		const listener = await listenerContext.newPage();
		let publisherToken = '';
		let publisherURL = '';
		actor.on('websocket', (socket) => {
			if (!socket.url().includes('/spectrum/ws')) return;
			socket.on('framereceived', ({ payload }) => {
				for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
					const event = JSON.parse(line);
					if (event.op === 'voice.credentials' && event.payload.canPublish) {
						publisherToken = event.payload.token;
						publisherURL = event.payload.url;
					}
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
		await actor.evaluate(() =>
			window.__voiceFixture.appSockets.at(-1)!.send(
				JSON.stringify({
					v: 2,
					op: 'voice.join',
					payload: { requestId: 'cache-publisher-for-revocation-test' }
				})
			)
		);
		await expect.poll(() => publisherToken).not.toBe('');
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
		await listener.getByLabel('People', { exact: true }).click();
		await expect(listener.getByText('Speaker is speaking', { exact: true })).toBeVisible({
			timeout: 15000
		});
		const speakingPellet = listener.locator('[data-pellet-id][data-speaking="true"]').first();
		await expect(speakingPellet).toBeVisible();
		expect(
			await speakingPellet.evaluate((el) => getComputedStyle(el, '::after').animationName)
		).toMatch(/speaking-pulse$/);
		const volume = listener.getByRole('slider', { name: 'Volume for Speaker', exact: true });
		await volume.evaluate((element) => {
			(element as HTMLInputElement).value = '0.35';
			element.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect
			.poll(() =>
				listener
					.locator('[data-voice-audio]')
					.first()
					.evaluate((element) => (element as HTMLMediaElement).volume)
			)
			.toBeCloseTo(0.35);
		await listener.getByLabel('People', { exact: true }).click();
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
		const stale = await page.request.get(
			publisherURL.replace(/^ws/, 'http') + '/rtc/validate?protocol=16',
			{
				headers: { Authorization: `Bearer ${publisherToken}` }
			}
		);
		expect(stale.status()).toBe(403);
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
		await expect
			.poll(() =>
				listener
					.locator('[data-voice-audio]')
					.first()
					.evaluate((element) => (element as HTMLMediaElement).volume)
			)
			.toBeCloseTo(0.35);
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
