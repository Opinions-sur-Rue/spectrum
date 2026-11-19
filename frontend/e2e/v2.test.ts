import { chromium, expect, firefox, type Page } from '@playwright/test';
import { isolateExternalStyles, newRoomContext, test } from './network-assets';
import { readFile } from 'node:fs/promises';
import { englishLocale } from './locale-state';
import {
	openActivity,
	openChat,
	openDiscussion,
	openPrivateNotes,
	openTranscript
} from './discussion';
import type { SpectrumState } from '../src/lib/canvas/room-client';
import AxeBuilder from '@axe-core/playwright';

test('design system aligns timer labels, toolbar controls and icons across themes and viewports', async ({
	page
}, testInfo) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const timer = page.getByLabel('Set timer', { exact: true });
	await expect(page.getByTitle('People', { exact: true })).toHaveAccessibleName('People · 1');
	await timer.click();
	await page.getByRole('button', { name: 'Start timer', exact: true }).click();
	await expect(page.getByRole('timer')).toBeVisible();
	for (const theme of ['lofi', 'light', 'dark']) {
		await page.getByTestId('app-menu').click();
		await page.getByTestId('theme-select').selectOption(theme);
		await page.getByTestId('app-menu').click();
		for (const width of [1440, 640, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			const controls = page.locator(
				'.session-controls > .v2-control, .session-controls .toolbar-summary, .content-actions > .btn, [data-testid="hand-toggle"], [data-testid="room-timer"]'
			);
			const styles = await controls.evaluateAll((nodes) =>
				nodes.map((node) => {
					const style = getComputedStyle(node);
					return {
						text: node.getAttribute('aria-label') ?? node.textContent,
						font: style.fontFamily,
						size: style.fontSize,
						weight: style.fontWeight,
						line: style.lineHeight,
						height: node.getBoundingClientRect().height
					};
				})
			);
			expect(styles.length).toBeGreaterThan(5);
			for (const style of styles) {
				expect(style.font, `${theme}/${width}/${style.text}`).toBe(styles[0].font);
				expect(style.size).toBe('12px');
				expect(style.weight).toBe('600');
				expect(style.line).toBe('15px');
				expect(style.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 36);
			}
			await expect(timer.locator('.toolbar-label')).toHaveCSS('font-size', '12px');
			await expect(timer.locator('.toolbar-label')).toHaveCSS('font-weight', '600');
			await expect(timer.locator('.iconoir-icon')).toHaveCSS('width', '18px');
			expect(
				await timer.locator('.iconoir-icon').evaluate((node) => getComputedStyle(node).maskImage)
			).not.toBe('none');
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width
			);
			if (width === 1440 || width === 390) {
				const audit = await new AxeBuilder({ page })
					.include('.v2-topbar')
					.include('.v2-actionbar')
					.analyze();
				expect(audit.violations).toEqual([]);
				await page.screenshot({
					path: testInfo.outputPath(`controls-${theme}-${width}.png`)
				});
			}
		}
		await page.setViewportSize({ width: 1440, height: 900 });
		await timer.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(timer).toBeFocused();
		await expect(timer).toHaveCSS('outline-style', 'solid');
		await timer.press('Enter');
		await expect(timer.locator('..')).toHaveAttribute('open', '');
		await timer.press('Escape');
	}
	// Root-level font preferences scale controls instead of leaving fixed tiny text.
	await page.evaluate(() => (document.documentElement.style.fontSize = '20px'));
	await expect(timer).toHaveCSS('font-size', '15px');
	await expect(timer.locator('.iconoir-icon')).toHaveCSS('width', '22.5px');
	await page.getByTestId('app-menu').click();
	await page.getByTestId('language-select').selectOption('fr');
	const frenchTimer = page.getByLabel('Régler le minuteur', { exact: true });
	await expect(frenchTimer).toBeVisible();
	await expect(frenchTimer.locator('.toolbar-label')).toHaveText('Minuteur');
	await expect(frenchTimer.locator('.toolbar-label')).toHaveCSS('font-size', '12px');
	await expect(frenchTimer.locator('.toolbar-label')).toHaveCSS('font-weight', '600');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await note.hover();
	const disabled = note.locator('.icon-button:disabled').first();
	await expect(disabled).toBeDisabled();
	await expect(disabled).toHaveCSS('opacity', '0.45');
	await page.screenshot({ path: testInfo.outputPath('controls-fr-note.png') });
});

for (const platform of ['android', 'ios']) {
	test(`mobile browser help offers ${platform} instructions without forced navigation`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.addInitScript((platform) => {
			Object.defineProperty(navigator, 'userAgent', {
				get: () =>
					platform === 'android'
						? 'Android 14; wv) Discord'
						: 'iPhone Version/18.0 Mobile Safari/604.1'
			});
		}, platform);
		await page.goto('/v2');
		const help = page.getByTestId('mobile-browser-help');
		await expect(help).toBeVisible();
		const details = help.locator('details');
		await expect(details).toHaveJSProperty('open', platform === 'android');
		if (platform === 'ios') await help.locator('summary').click();
		await expect(help).toContainText(platform === 'android' ? 'Android:' : 'iPhone / iPad:');
		await expect(help.getByRole('textbox')).toHaveValue(page.url());
		await expect(help).toContainText('private notes do not transfer');
		await expect(page.getByTestId('create-room')).toBeVisible();
		const results = await new AxeBuilder({ page })
			.include('[data-testid="mobile-browser-help"]')
			.analyze();
		expect(results.violations).toEqual([]);
		await help.getByRole('button', { name: 'Collapse help' }).click();
		await page.getByTestId('create-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await help.locator('summary').click();
		await expect(help.getByRole('textbox')).toHaveValue(page.url());
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);
	});
}

test('readability: empty notes keep placeholders out of stored content and claim stays single-line', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('edit-pseudonym').click();
	const nickname = 'Un pseudonyme volontairement très long';
	await page.getByLabel('Your pseudonym', { exact: true }).fill(nickname);
	await page.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
	await page.getByTitle('People', { exact: true }).click();
	const label = page.locator('[data-own="true"] [data-pellet-label]');
	await expect(label).toContainText(nickname);
	await expect
		.poll(() =>
			label.evaluate(
				(node) =>
					node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis'
			)
		)
		.toBe(true);
	await expect(page.locator('[data-own="true"]')).toHaveAttribute('title', new RegExp(nickname));
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await expect(note.locator('[data-note-author]')).toHaveText(`By ${nickname}`);
	await expect(note.getByRole('heading', { level: 1 })).toHaveText('');
	await expect(note.getByRole('textbox', { name: 'Note content' })).toHaveText('');
	await note.hover();
	await expect(note.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
	await expect
		.poll(() =>
			note
				.getByRole('heading', { level: 1 })
				.evaluate((node) => getComputedStyle(node, '::before').content)
		)
		.toBe('"New note"');
	await page.reload();
	await expect(note.getByRole('textbox', { name: 'Note content' })).toHaveText('');
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.getByTestId('edit-claim').click();
		const input = page.getByTestId('claim-input');
		await expect(input).toHaveJSProperty('tagName', 'INPUT');
		await input.fill('Une proposition sur une seule ligne');
		await expect(input).toBeFocused();
		await input.press('Control+Enter');
		await expect(input).toHaveCount(0);
		const heading = page.getByTestId('room-claim').getByRole('heading', { level: 1 });
		await expect(heading).toHaveText('Une proposition sur une seule ligne');
		expect(await heading.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
		await expect(heading).toHaveCSS('text-align', 'center');
		const box = (await heading.boundingBox())!;
		const edit = (await page.getByTestId('edit-claim').boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(edit.x);
		expect(edit.x + edit.width).toBeLessThanOrEqual(viewport.width);
		await page.getByTestId('edit-claim').click();
		await input.fill('Cancelled claim');
		await input.press('Escape');
		await expect(heading).toHaveText('Une proposition sur une seule ligne');
	}
});

test('single-line proposition fits a narrow screen and full text remains accessible', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/v2');
	const topic =
		'Faut-il rendre les transports en commun gratuits pour tous, y compris les personnes résidant dans les communes périphériques ?';
	await page.getByTestId('initial-topic').fill(topic);
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const heading = page.getByTestId('room-claim').getByRole('heading', { level: 1 });
	const read = heading.getByRole('button');
	await expect(heading).toHaveText(topic);
	await expect(read).toHaveCSS('white-space', 'nowrap');
	await expect(read).toHaveCSS('text-overflow', 'ellipsis');
	expect(await read.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
	const box = (await read.boundingBox())!;
	const edit = (await page.getByTestId('edit-claim').boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(edit.x);
	expect(edit.x + edit.width).toBeLessThanOrEqual(320);
	await read.click();
	await expect(page.getByRole('dialog')).toContainText(topic);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(read).toBeFocused();
	await page.getByTestId('edit-claim').click();
	await page.getByTestId('claim-input').fill('One new proposition');
	await page.getByTestId('claim-input').press('Enter');
	await expect(heading).toHaveText('One new proposition');
});

for (const compact of [false, true]) {
	test(`note deletion waits for explicit confirmation and cancellation keeps content (${compact ? 'mobile' : 'desktop'})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: compact ? 390 : 1280, height: compact ? 844 : 900 });
		const deletions: unknown[] = [];
		page.on('websocket', (socket) => {
			if (!socket.url().includes('/spectrum/ws')) return;
			socket.on('framesent', ({ payload }) => {
				const message = JSON.parse(String(payload));
				if (message.op === 'note.delete') deletions.push(message.payload);
			});
		});
		await page.goto('/v2');
		await page.getByTestId('create-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await page.getByTestId('new-note').click();
		const note = page.locator('[data-note-id]').first();
		if (compact) await note.locator('[data-note-inspect]').click();
		await note.getByRole('heading', { level: 1 }).fill('Protected note');
		await note.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(note).toHaveAttribute('aria-label', 'Protected note');
		const remove = note.getByRole('button', { name: 'Delete', exact: true });
		await note.getByRole('textbox', { name: 'Note content' }).focus();
		await remove.click();
		const confirmation = page.getByRole('dialog', { name: /Delete .*Protected note/ });
		await expect(confirmation).toBeVisible();
		expect(deletions).toHaveLength(0);
		await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(note).toHaveCount(1);
		await expect(remove).toBeFocused();
		await remove.click();
		await page.keyboard.press('Escape');
		await expect(confirmation).toHaveCount(0);
		expect(deletions).toHaveLength(0);
		await remove.click();
		await confirmation.getByTestId('confirm-session-action').click();
		await expect(note).toHaveCount(0);
		expect(deletions).toHaveLength(1);
	});
}

for (const compact of [false, true]) {
	test(`private note clearing requires confirmation without sending its content (${compact ? 'mobile' : 'desktop'})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: compact ? 390 : 1280, height: compact ? 844 : 900 });
		const messages: string[] = [];
		page.on('websocket', (socket) => {
			if (socket.url().includes('/spectrum/ws'))
				socket.on('framesent', ({ payload }) => messages.push(String(payload)));
		});
		await page.goto('/v2');
		await page.getByTestId('create-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await openPrivateNotes(page);
		const input = page.getByTestId('personal-notes-input');
		const text = 'A browser-only draft that must not be sent';
		await input.fill(text);
		await expect(page.getByTestId('personal-notes-status')).toHaveText('Saved on this device');
		await page.getByTestId('personal-notes-clear').click();
		const confirmation = page.getByRole('dialog', { name: 'Delete your private notes?' });
		await expect(confirmation).toBeVisible();
		await expect(input).toHaveValue(text);
		const confirm = confirmation.getByTestId('confirm-session-action');
		const cancel = confirmation.getByRole('button', { name: 'Cancel', exact: true });
		await confirm.focus();
		await page.keyboard.press('Tab');
		await expect(cancel).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(confirm).toBeFocused();
		await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(input).toHaveValue(text);
		await page.getByTestId('personal-notes-clear').click();
		await confirmation.getByTestId('confirm-session-action').click();
		await expect(input).toHaveValue('');
		expect(messages.some((message) => message.includes(text))).toBe(false);
		await page.reload();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await openPrivateNotes(page);
		await expect(page.getByTestId('personal-notes-input')).toHaveValue('');
	});
}

for (const demoteWhileSuspended of [false, true]) {
	test(`mobile resume restores identity and ${demoteWhileSuspended ? 'respects offline demotion' : 'stage membership'}`, async ({
		page: admin,
		browser
	}) => {
		const context = await newRoomContext(browser, {
			storageState: englishLocale,
			viewport: { width: 390, height: 844 }
		});
		try {
			const guest = await context.newPage();
			for (const page of [admin, guest]) {
				await page.addInitScript(() => {
					const probe = {
						sockets: [] as { socket: WebSocket; frozen: boolean }[],
						room: null as null | { userId: string; members: { id: string; nickname: string }[] }
					};
					Object.assign(window, { __mobileRecovery: probe });
					const Native = window.WebSocket;
					window.WebSocket = new Proxy(Native, {
						construct(target, args) {
							const socket = Reflect.construct(target, args) as WebSocket;
							if (!socket.url.includes('/spectrum/ws')) return socket;
							const entry = { socket, frozen: false };
							probe.sockets.push(entry);
							const send = socket.send.bind(socket);
							socket.send = (data) => {
								if (!entry.frozen) send(data);
							};
							socket.addEventListener('message', (event) => {
								if (entry.frozen) {
									event.stopImmediatePropagation();
									return;
								}
								for (const line of String(event.data).split(/\r?\n/).filter(Boolean)) {
									const message = JSON.parse(line);
									if (message.op === 'room.state') probe.room = message.payload;
								}
							});
							return socket;
						}
					});
				});
			}
			await admin.goto('/v2');
			await admin.getByTestId('create-room').click();
			await expect(admin.getByTestId('own-role')).toHaveText('admin');
			await guest.goto(admin.url());
			await expect(guest.getByTestId('own-role')).toHaveText('spectator');
			await guest.evaluate(() => {
				const probe = (
					window as unknown as { __mobileRecovery: { sockets: { socket: WebSocket }[] } }
				).__mobileRecovery;
				probe.sockets
					.at(-1)!
					.socket.send(
						JSON.stringify({ v: 2, op: 'room.profile', payload: { nickname: 'Mobile identity' } })
					);
			});
			await expect(guest.getByTestId('edit-pseudonym')).toContainText('Mobile identity');
			await admin.getByTitle('People', { exact: true }).click();
			await admin.getByRole('button', { name: 'Promote Mobile identity', exact: true }).click();
			await expect(guest.getByTestId('own-role')).toHaveText('participant');
			const identity = await guest.evaluate(() => sessionStorage.getItem('spectrum-v2-user'));
			const publicID = await guest.evaluate(
				() =>
					(window as unknown as { __mobileRecovery: { room: { userId: string } } }).__mobileRecovery
						.room.userId
			);
			const roomURL = guest.url();
			await guest.evaluate(() => {
				const probe = (
					window as unknown as { __mobileRecovery: { sockets: { frozen: boolean }[] } }
				).__mobileRecovery;
				probe.sockets.at(-1)!.frozen = true;
			});
			if (demoteWhileSuspended)
				await admin.getByRole('button', { name: 'Demote Mobile identity', exact: true }).click();
			await guest.evaluate(() => window.dispatchEvent(new Event('pageshow')));
			await expect
				.poll(
					() =>
						guest.evaluate(
							() =>
								(window as unknown as { __mobileRecovery: { sockets: unknown[] } }).__mobileRecovery
									.sockets.length
						),
					{ timeout: 15000 }
				)
				.toBe(2);
			await expect(guest.getByTestId('own-role')).toHaveText(
				demoteWhileSuspended ? 'spectator' : 'participant'
			);
			await expect(guest.getByTestId('edit-pseudonym')).toContainText('Mobile identity');
			await guest.reload();
			await expect(guest.getByTestId('own-role')).toHaveText(
				demoteWhileSuspended ? 'spectator' : 'participant'
			);
			await expect(guest.getByTestId('edit-pseudonym')).toContainText('Mobile identity');
			expect(await guest.evaluate(() => sessionStorage.getItem('spectrum-v2-user'))).toBe(identity);
			expect(
				await guest.evaluate(
					() =>
						(window as unknown as { __mobileRecovery: { room: { userId: string } } })
							.__mobileRecovery.room.userId
				)
			).toBe(publicID);
			expect(guest.url()).toBe(roomURL);
		} finally {
			await context.close();
		}
	});
}

test('lobby explains invalid invitations and accepts a pasted lowercase invitation', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const invitation = page.url().toLowerCase();
	const context = await newRoomContext(browser, {
		storageState: englishLocale,
		viewport: { width: 390, height: 844 }
	});
	try {
		const guest = await context.newPage();
		await guest.goto(new URL('/v2', page.url()).href);
		const input = guest.getByLabel('Room ID', { exact: true });
		await input.fill('https://example.com/index');
		await guest.getByTestId('join-room').click();
		await expect(input).toHaveAttribute('aria-invalid', 'true');
		await expect(input).toBeFocused();
		await expect(guest.getByRole('alert')).toContainText('valid room code');
		await input.fill(invitation);
		await expect(input).toHaveAttribute('aria-invalid', 'false');
		await guest.getByTestId('join-room').click();
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
	} finally {
		await context.close();
	}
});

test('note navigation searches without accents and clears or selects results on mobile', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await note.getByRole('heading', { level: 1 }).fill('Énergie partagée');
	await note.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect(note.locator('.unsaved')).toHaveCount(0);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.keyboard.press('Control+k');
	const navigator = page.getByTestId('note-navigator');
	const search = navigator.getByRole('searchbox', { name: 'Search notes' });
	await expect(search).toBeFocused();
	await search.fill('ENERGIE');
	await expect(navigator.locator('mark').first()).toHaveText('Énergie');
	await expect(
		navigator.getByRole('button', { name: 'Énergie partagée', exact: true })
	).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(note).toBeFocused();
	await page.getByLabel('Find a note', { exact: true }).click();
	await expect(search).toBeFocused();
	await search.fill('absent');
	await expect(navigator).toContainText('No matching notes');
	await navigator.getByRole('button', { name: 'Clear note search' }).click();
	await expect(search).toBeFocused();
	await expect(search).toHaveValue('');
	await navigator.getByRole('button', { name: 'Énergie partagée', exact: true }).click();
	await expect(note).toBeFocused();
});

test('getting-started help opens on demand in a compact modal with a pseudonym step', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const dialog = page.getByTestId('room-onboarding-dialog');
	await expect(dialog).toHaveCount(0);
	const trigger = page.getByTestId('room-onboarding');
	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('Three things to try');
	await expect(dialog).toContainText('Link symbols');
	await expect(dialog.getByText('supports', { exact: true })).toBeVisible();
	const pseudonym = dialog.getByLabel('Your pseudonym');
	await pseudonym.fill('Ada');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog.getByRole('status')).toContainText('Pseudonym saved');
	await expect(page.getByTestId('edit-pseudonym')).toContainText('Ada');
	await dialog.getByRole('button', { name: 'Close help' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test('offline banner explains paused changes and clears after reconnect', async ({ page }) => {
	let drop: (() => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		drop ??= () => socket.close();
		socket.connectToServer();
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await expect(page.getByTestId('offline-banner')).toHaveCount(0);
	drop?.();
	await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 20000 });
	await expect(page.getByTestId('offline-banner')).toContainText('Changes are paused');
	await expect(page.getByTestId('offline-banner')).toHaveCount(0, { timeout: 30000 });
	await expect(page.getByTestId('own-role')).toHaveText('admin');
});

test('note export downloads a Markdown copy of the visible notes', async ({ page }) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await note.getByRole('heading', { level: 1 }).fill('Énergie partagée');
	await note.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect(note.locator('.unsaved')).toHaveCount(0);
	await page.getByTestId('app-menu').click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-notes').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^spectrum-OSR-[A-Z0-9]+-\d{4}-\d{2}-\d{2}\.md$/);
	const content = await readFile(await download.path(), 'utf8');
	expect(content).toContain('# Spectrum — OSR-');
	expect(content).toContain('## Énergie partagée');
	expect(content).toContain('Exported');
});

test('a dead invitation opened from inside a room is explained without raw protocol text', async ({
	page
}) => {
	let inject: ((message: unknown) => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		socket.connectToServer();
		inject = (message) => socket.send(JSON.stringify(message));
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	inject?.({
		v: 2,
		op: 'error',
		payload: { code: 'room_join_failed', message: 'operation not allowed for this role' }
	});
	const banner = page.locator('[role="alert"]').first();
	await expect(banner).toContainText('not available from inside a room');
	await expect(banner).not.toContainText('operation not allowed');
	await expect(page.getByTestId('own-role')).toHaveText('admin');
});

test('admin timer is shared, silently finishes and restores without replay after reload', async ({
	page,
	browser
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const spectator = await context.newPage();
		await spectator.emulateMedia({ reducedMotion: 'reduce' });
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await expect(spectator.getByLabel('Set timer', { exact: true })).toHaveCount(0);
		await page.getByLabel('Set timer', { exact: true }).click();
		await page.getByRole('button', { name: '1 min', exact: true }).click();
		await expect(page.getByLabel('Minutes', { exact: true })).toHaveValue('1');
		await expect(page.getByLabel('Seconds', { exact: true })).toHaveValue('0');
		await expect(page.getByTestId('room-timer')).toHaveCount(0);
		await page.getByLabel('Minutes', { exact: true }).fill('0');
		await page.getByLabel('Seconds', { exact: true }).fill('3');
		await page.getByRole('button', { name: 'Start timer', exact: true }).click();
		await expect(spectator.getByTestId('room-timer')).toBeVisible();
		await expect(page).toHaveTitle(/⏱ \d+:\d{2} · Spectrum v2/);
		await expect(spectator).toHaveTitle(/⏱ \d+:\d{2} · Spectrum v2/);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		for (const client of [page, spectator]) {
			await expect(client.getByRole('timer')).toHaveText('0:00', { timeout: 10000 });
			await expect(client.getByTestId('room-timer')).toHaveAttribute('data-finished', 'true');
			await expect(client.getByTestId('room-timer').getByRole('status')).toHaveText('Time is up');
			await expect(client.locator('audio')).toHaveCount(0);
		}
		await expect(spectator.getByTestId('room-timer')).toHaveCSS('animation-name', 'none');
		await spectator.reload();
		await expect(spectator.getByRole('timer')).toHaveText('0:00');
		await expect(spectator.getByTestId('room-timer')).toHaveAttribute('data-finished', 'false');
		await expect(spectator.getByTestId('room-timer').getByRole('status')).toHaveText('Time is up');
		await expect(spectator).toHaveTitle('⏱ Time is up · Spectrum v2');
		await page.getByLabel('Set timer', { exact: true }).click();
		await page.getByRole('button', { name: 'Clear timer', exact: true }).click();
		await expect(spectator.getByTestId('room-timer')).toHaveCount(0);
		await expect(spectator).toHaveTitle(/^Spectrum v2 · OSR-/);
	} finally {
		await context.close();
	}
});

test('canvas navigation: note index respects spectator visibility and zoom buttons stop at limits', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await note.getByRole('heading', { level: 1 }).fill('Private navigation title');
	await note.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect(note.locator('.unsaved')).toHaveCount(0);
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const spectator = await context.newPage();
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await spectator.getByLabel('Find a note', { exact: true }).click();
		await expect(spectator.getByTestId('note-navigator')).toContainText('No notes available');
		await expect(spectator.getByTestId('note-navigator')).not.toContainText(
			'Private navigation title'
		);
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Show revealed notes to spectators').check();
		await page.getByLabel('Room options', { exact: true }).click();
		await note.hover();
		await note.getByRole('textbox', { name: 'Note content' }).focus();
		await note.getByRole('button', { name: 'Approve', exact: true }).click();
		await note.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectator.getByTestId('note-navigator')).toContainText('Private navigation title');
		await note.getByRole('button', { name: 'Hide', exact: true }).click();
		await expect(spectator.getByTestId('note-navigator')).not.toContainText(
			'Private navigation title'
		);
	} finally {
		await context.close();
	}
	const plus = page.getByRole('button', { name: 'Zoom +', exact: true });
	const minus = page.getByRole('button', { name: 'Zoom −', exact: true });
	for (let count = 0; count < 25 && (await plus.isEnabled()); count++) await plus.click();
	await expect(plus).toBeDisabled();
	await expect(page.locator('.zoom-value')).toHaveText('300%');
	for (let count = 0; count < 25 && (await minus.isEnabled()); count++) await minus.click();
	await expect(minus).toBeDisabled();
	await expect(page.locator('.zoom-value')).toHaveText('20%');
	await page.getByLabel('Find a note', { exact: true }).click();
	await page
		.getByTestId('note-navigator')
		.getByRole('button', { name: 'Private navigation title', exact: true })
		.click();
	await expect(note).toBeFocused();
});

test('canvas navigation: find resized offscreen notes without losing drafts or camera context', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		server.onMessage((raw) => {
			for (const line of String(raw).split(/\r?\n/).filter(Boolean)) {
				const message = JSON.parse(line);
				if (message.op === 'canvas.snapshot')
					for (const note of message.payload.notes ?? [])
						Object.assign(note, { x: 3000, y: 1000, width: 1000, height: 800 });
				socket.send(JSON.stringify(message));
			}
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const card = page.locator('[data-note-id]').first();
	await expect(card).toHaveCount(1);
	async function find(title: string) {
		await page.getByLabel('Find a note', { exact: true }).click();
		await page
			.getByTestId('note-navigator')
			.getByRole('button', { name: title, exact: true })
			.click();
		await expect(card).toBeFocused();
		await expect
			.poll(async () => {
				const note = (await card.boundingBox())!;
				const canvas = (await page.getByTestId('canvas-viewport').boundingBox())!;
				return (
					note.x >= canvas.x &&
					note.y >= canvas.y &&
					note.x + note.width <= canvas.x + canvas.width + 1 &&
					note.y + note.height <= canvas.y + canvas.height - 50
				);
			})
			.toBe(true);
	}
	await find('Untitled note');
	await card.getByRole('heading', { level: 1 }).fill('Unsaved navigation draft');
	await page.getByRole('button', { name: 'Recenter spectrum', exact: true }).click();
	await find('Untitled note');
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Unsaved navigation draft');
	await expect(card.locator('.unsaved')).toBeVisible();
	async function view() {
		return page.getByTestId('canvas-viewport').evaluate((node) => {
			const world = node.querySelector<HTMLElement>('.origin-top-left')!;
			const matrix = new DOMMatrix(getComputedStyle(world).transform);
			return {
				x: (node.clientWidth / 2 - matrix.e) / matrix.a,
				y: (node.clientHeight / 2 - matrix.f) / matrix.a,
				scale: matrix.a
			};
		});
	}
	const before = await view();
	await page.getByTestId('discussion-toggle').click();
	await expect.poll(async () => Math.abs((await view()).x - before.x)).toBeLessThan(0.1);
	await expect.poll(async () => Math.abs((await view()).scale - before.scale)).toBeLessThan(0.001);
	await page.getByTestId('discussion-close').click();
	await expect.poll(async () => Math.abs((await view()).y - before.y)).toBeLessThan(0.1);
	await page.setViewportSize({ width: 390, height: 844 });
	await find('Untitled note');
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Unsaved navigation draft');
});

test('moderation: a departed target cancels its pending confirmation and restores focus', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await context.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Remove / }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await guest.getByLabel('Session actions', { exact: true }).click();
		await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
		await guest.getByTestId('confirm-session-action').click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByTitle('People', { exact: true })).toBeFocused();
	} finally {
		await context.close();
	}
});

test('moderation: lost authority cancels pending admin appointment and room closure confirmations', async ({
	page,
	browser
}) => {
	let latest: Record<string, unknown> | undefined;
	let deliver: ((state: Record<string, unknown>) => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		deliver = (state) => socket.send(JSON.stringify({ v: 2, op: 'room.state', payload: state }));
		server.onMessage((raw) => {
			for (const line of String(raw).split(/\r?\n/).filter(Boolean)) {
				const message = JSON.parse(line);
				if (message.op === 'room.state') latest = message.payload;
				socket.send(line);
			}
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await context.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Promote / }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		await page.getByRole('button', { name: /^Make .+ admin$/ }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		deliver!({
			...latest!,
			members: (latest!.members as { role: string }[]).map((member) =>
				member.role === 'participant' ? { ...member, role: 'spectator' } : member
			)
		});
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByTitle('People', { exact: true })).toBeFocused();
		deliver!(latest!);
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Make .+ admin$/ }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		// Authoritative protocol fixture: same revision, new role. Server ACLs
		// have separate Go coverage; this tests immediate frontend invalidation.
		deliver!({ ...latest!, role: 'participant' });
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByTitle('People', { exact: true })).toBeFocused();
		deliver!({ ...latest!, role: 'admin' });
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await page.getByLabel('Session actions', { exact: true }).click();
		await page.getByRole('button', { name: 'End session', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		deliver!({ ...latest!, role: 'participant' });
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByLabel('Session actions', { exact: true })).toBeFocused();
	} finally {
		await context.close();
	}
});

test('network: pending destructive confirmation never re-arms after reconnect', async ({
	page
}) => {
	const network = await roomInterruption(page);
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByLabel('Session actions', { exact: true }).click();
	await page.getByRole('button', { name: 'End session', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await network.interrupt();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await network.resume();
	await expect(page.getByTestId('new-note')).toBeEnabled();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByTestId('own-role')).toHaveText('admin');
});

test('network: delayed note save acknowledgment never overwrites newer typing', async ({
	page
}) => {
	let hold = false;
	const queued: (() => void)[] = [];
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((raw) => {
			if (JSON.parse(String(raw)).op === 'note.update') hold = true;
			server.send(raw);
		});
		server.onMessage((raw) => {
			if (hold) queued.push(() => socket.send(raw));
			else socket.send(raw);
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const card = page.locator('[data-note-id]').first();
	await card.getByRole('heading', { level: 1 }).fill('First saved revision');
	await card.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect.poll(() => queued.length).toBeGreaterThan(0);
	await card.getByRole('heading', { level: 1 }).fill('Newer local revision');
	hold = false;
	for (const deliver of queued.splice(0)) deliver();
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Newer local revision');
	await expect(card.locator('.conflict')).toBeVisible();
	await expect(card.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
	await card.locator('.conflict button').click();
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('First saved revision');
});

for (const accepted of [false, true]) {
	test(`network: note save ${accepted ? 'accepted before lost acknowledgment' : 'lost before delivery'} survives repeated reconnects`, async ({
		page
	}) => {
		let intercept = true;
		let dropped = false;
		let cut: (() => void) | undefined;
		await page.routeWebSocket('**/spectrum/ws', (socket) => {
			const server = socket.connectToServer();
			cut = () => socket.close({ code: 1012, reason: 'Save delivery regression' });
			socket.onMessage((raw) => {
				if (intercept && !accepted && JSON.parse(String(raw)).op === 'note.update') {
					intercept = false;
					dropped = true;
					cut!();
				} else server.send(raw);
			});
			server.onMessage((raw) => {
				if (dropped) return;
				const lines = String(raw).split(/\r?\n/).filter(Boolean);
				if (intercept && accepted && lines.some((line) => JSON.parse(line).op === 'note.updated')) {
					intercept = false;
					dropped = true;
					cut!();
				} else socket.send(raw);
			});
			dropped = false;
		});
		await page.goto('/v2');
		await page.getByTestId('create-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await page.getByTestId('new-note').click();
		const card = page.locator('[data-note-id]').first();
		await card.getByRole('heading', { level: 1 }).fill('Draft across delivery uncertainty');
		await card.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(card).toHaveCount(0);
		await expect(card.getByRole('heading', { level: 1 })).toHaveText(
			'Draft across delivery uncertainty'
		);
		await card.getByRole('textbox', { name: 'Note content', exact: true }).focus();
		await expect(card.locator('.unsaved')).toHaveCount(accepted ? 0 : 1);
		for (let index = 0; index < 2; index++) {
			cut!();
			await expect(card).toHaveCount(0);
			await expect(card.getByRole('heading', { level: 1 })).toHaveText(
				'Draft across delivery uncertainty'
			);
		}
		if (!accepted) {
			await card.getByRole('textbox', { name: 'Note content', exact: true }).focus();
			await card.getByRole('button', { name: 'Save note', exact: true }).click();
			await expect(card.locator('.unsaved')).toHaveCount(0);
		}
		await page.reload();
		await expect(card.getByRole('heading', { level: 1 })).toHaveText(
			'Draft across delivery uncertainty'
		);
	});
}

test('accessibility: lobby, room menus, notes and Discussion have no WCAG AA violations', async ({
	page
}) => {
	async function accessible() {
		const result = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.analyze();
		expect(
			result.violations.map(({ id, nodes }) => ({
				id,
				nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
			}))
		).toEqual([]);
	}
	await page.goto('/v2');
	await accessible();
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	for (const theme of ['lofi', 'light', 'dark']) {
		await page.evaluate((value) => {
			document.documentElement.dataset.theme = value;
		}, theme);
		await accessible();
	}
	await page.evaluate(() => {
		document.documentElement.dataset.theme = 'lofi';
	});
	await page.getByTestId('new-note').click();
	await expect(page.locator('[data-note-id]')).toHaveCount(1);
	await accessible();
	for (const trigger of [
		page.getByTitle('People', { exact: true }),
		page.getByLabel('Room options', { exact: true }),
		page.getByTestId('app-menu'),
		page.getByLabel('Find a note', { exact: true })
	]) {
		await trigger.click();
		for (const theme of ['lofi', 'light', 'dark']) {
			await page.evaluate((value) => {
				document.documentElement.dataset.theme = value;
			}, theme);
			await accessible();
		}
		await page.keyboard.press('Escape');
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByTestId('discussion-toggle').click();
	await expect(page.getByTestId('discussion-panel')).toBeVisible();
	await accessible();
});

test('accessibility: Discussion traps focus after responsive transition and scroll panels are keyboard reachable', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('discussion-toggle').click();
	// On desktop the background stays operable. At mobile size it becomes inert;
	// focus must move from that background into the newly modal panel.
	await page.getByTestId('edit-claim').focus();
	await page.setViewportSize({ width: 640, height: 450 });
	await expect(page.getByTestId('discussion-tab-chat')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('discussion-tab-activity')).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('tabpanel', { name: 'Activity', exact: true })).toBeFocused();
	await page.getByTestId('discussion-close').focus();
	await page.keyboard.press('Shift+Tab');
	await expect
		.poll(() =>
			page.getByTestId('discussion-panel').evaluate((node) => node.contains(document.activeElement))
		)
		.toBe(true);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('discussion-toggle')).toBeFocused();
});

test('edge cases: long content and crowded menus reflow at 200-percent-equivalent viewport', async ({
	page
}) => {
	// 1280×900 at 200% browser zoom has a 640×450 CSS viewport. This checks
	// reflow, not physical device pixels or OS/browser zoom controls.
	await page.setViewportSize({ width: 640, height: 450 });
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		server.onMessage((raw) => {
			for (const line of String(raw).split(/\r?\n/).filter(Boolean)) {
				const message = JSON.parse(line);
				if (message.op === 'room.state') {
					message.payload.members.push(
						...Array.from({ length: 80 }, (_, index) => ({
							id: `m_crowded_${index}`,
							nickname: `Spectator${index}${'W'.repeat(30)}`,
							role: 'spectator'
						}))
					);
				}
				socket.send(JSON.stringify(message));
			}
		});
	});
	await page.goto('/v2');
	await page.getByTestId('initial-topic').fill('W'.repeat(500));
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await expect(page.getByTestId('room-claim')).toContainText('W'.repeat(500));
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
		true
	);
	await page.getByTitle('People', { exact: true }).click();
	const menu = page.getByTestId('people-panel');
	await expect(menu.locator('[data-member-id]')).toHaveCount(81);
	const save = menu.getByRole('button', { name: 'Save pseudonym', exact: true });
	await menu.getByRole('textbox', { name: 'Your pseudonym', exact: true }).fill('Long nickname');
	await save.focus();
	await expect(save).toBeInViewport();
	await menu
		.locator('[data-member-id]')
		.last()
		.getByRole('button', { name: /^Remove / })
		.click();
	const confirmation = page.getByRole('dialog');
	await expect(confirmation).toBeVisible();
	const confirm = confirmation.getByTestId('confirm-session-action');
	await confirm.focus();
	await expect(confirm).toBeInViewport();
	expect(await confirmation.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
		true
	);
	await page.keyboard.press('Escape');
	await expect(confirmation).toHaveCount(0);
	await page.getByTitle('People', { exact: true }).focus();
	await page.keyboard.press('Escape');
	await expect(page.getByTitle('People', { exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Invite', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	const close = dialog.getByRole('button', { name: 'Close', exact: true });
	await close.focus();
	await expect(close).toBeInViewport();
	expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeFocused();
	await page.getByTestId('discussion-toggle').click();
	await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill('X'.repeat(1000));
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-chat-id]').last()).toContainText('X'.repeat(1000));
	expect(
		await page
			.getByTestId('discussion-panel')
			.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
	).toBe(true);
});

function cssPixels(style: string | null, property: string) {
	const match = new RegExp(`${property}:\\s*(-?[\\d.]+)px`).exec(style ?? '');
	return match ? Number(match[1]) : Number.NaN;
}

async function roomInterruption(page: Page) {
	let current: { close: (options: { code: number; reason: string }) => void } | undefined;
	let paused = false;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		current = socket;
		// Refuse retries while offline rather than retaining mock sockets that
		// the client's bounded signin timeout may already have retired.
		if (paused) socket.close({ code: 1013, reason: 'Controlled offline transport' });
		else socket.connectToServer();
	});
	return {
		async interrupt() {
			paused = true;
			if (!current) throw new Error('Missing room connection');
			current.close({ code: 1012, reason: 'Controlled reconnect test' });
			await expect(page.getByTestId('connection-state')).not.toHaveAttribute(
				'data-status',
				'Connected'
			);
			await expect(page.locator('[data-note-id]')).toHaveCount(0);
		},
		async resume() {
			paused = false;
			await expect(page.getByTestId('connection-state')).toHaveAttribute(
				'data-status',
				'Connected'
			);
		}
	};
}

test('note drafts survive room reconnection without publishing or persisting them', async ({
	page
}) => {
	const network = await roomInterruption(page);
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const card = page.locator('[data-note-id]').first();
	await card.getByRole('heading', { level: 1 }).fill('Unsaved reconnect draft');
	await expect(card.locator('.unsaved')).toBeVisible();
	await network.interrupt();
	await network.resume();
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Unsaved reconnect draft');
	await card.getByRole('textbox', { name: 'Note content', exact: true }).focus();
	await expect(card.locator('.unsaved')).toBeVisible();
	await page.getByTestId('app-menu').click();
	await page.getByTestId('presentation-toggle').click();
	await expect(card).toBeHidden();
	await network.interrupt();
	await network.resume();
	await expect(card).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Unsaved reconnect draft');
	await card.getByRole('textbox', { name: 'Note content', exact: true }).focus();
	expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
		'Unsaved reconnect draft'
	);
	await card.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect(card.locator('.unsaved')).toHaveCount(0);
	await page.reload();
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Unsaved reconnect draft');
});

for (const change of ['revoked', 'edited'] as const) {
	test(`reconnected note draft respects ${change} authority or server content`, async ({
		page,
		browser
	}) => {
		await page.goto('/v2');
		await page.getByTestId('create-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		const context = await newRoomContext(browser, { storageState: englishLocale });
		try {
			const author = await context.newPage();
			const network = await roomInterruption(author);
			if (change === 'revoked') await author.setViewportSize({ width: 390, height: 844 });
			await author.goto(page.url());
			await expect(author.getByTestId('own-role')).toHaveText('spectator');
			await page.getByTitle('People', { exact: true }).click();
			await page.getByRole('button', { name: /^Promote / }).click();
			await page.getByTitle('People', { exact: true }).click();
			await expect(author.getByTestId('own-role')).toHaveText('participant');
			await author.getByTestId('new-note').click();
			const card = author.locator('[data-note-id]').first();
			await card.getByRole('heading', { level: 1 }).fill('Private author draft');
			if (change === 'revoked') {
				await card.locator('[data-note-inspect]').click();
				await expect(author.getByRole('dialog')).toBeVisible();
			}
			await expect(page.locator('[data-note-id]')).toHaveCount(1);
			await network.interrupt();
			if (change === 'revoked') await expect(author.getByRole('dialog')).toHaveCount(0);
			if (change === 'revoked') {
				await page.getByTitle('People', { exact: true }).click();
				await page.getByRole('button', { name: /^Demote / }).click();
				await page.getByTitle('People', { exact: true }).click();
			} else {
				// A second tab belonging to the same author can change content;
				// admin rights no longer grant ownership of another person's text.
				const signin = await author.evaluate(() => sessionStorage.getItem('spectrum-v2-user'));
				const authorTab = await context.newPage();
				await authorTab.addInitScript(
					(id) => sessionStorage.setItem('spectrum-v2-user', id!),
					signin
				);
				await authorTab.goto(page.url());
				await expect(authorTab.getByTestId('own-role')).toHaveText('participant');
				const remote = authorTab.locator('[data-note-id]').first();
				await remote.getByRole('heading', { level: 1 }).fill('Changed on server');
				await remote.getByRole('button', { name: 'Save note', exact: true }).click();
				await expect(remote.locator('.unsaved')).toHaveCount(0);
				await authorTab.close();
			}
			await network.resume();
			if (change === 'revoked') {
				await expect(author.getByTestId('own-role')).toHaveText('spectator');
				await expect(card).toHaveCount(0);
				await expect(author.locator('body')).not.toContainText('Private author draft');
				await page.getByTitle('People', { exact: true }).click();
				await page.getByRole('button', { name: /^Promote / }).click();
				await expect(author.getByTestId('own-role')).toHaveText('participant');
				await expect(card.getByRole('heading', { level: 1 })).toHaveText('');
			} else {
				await expect(card.getByRole('heading', { level: 1 })).toHaveText('Private author draft');
				await card.getByRole('textbox', { name: 'Note content', exact: true }).focus();
				await expect(card.locator('.conflict')).toBeVisible();
				await expect(card.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
				await card.locator('.conflict button').click();
				await expect(card.getByRole('heading', { level: 1 })).toHaveText('Changed on server');
			}
		} finally {
			await context.close();
		}
	});
}

test('journal entries retain readable text contrast in every theme', async ({ page }) => {
	await page.goto('/v2');
	await page.getByTestId('initial-topic').fill('A contrast check');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await openActivity(page);
	await expect(page.locator('#room-activity li[data-event-kind="topic"]')).toBeVisible();
	for (const theme of ['lofi', 'light', 'dark']) {
		await page.getByTestId('app-menu').click();
		await page.getByTestId('theme-select').selectOption(theme);
		await page.keyboard.press('Escape');
		const ratios = await page.locator('#room-activity li').evaluateAll((entries) => {
			function luminance(color: string) {
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 1;
				const context = canvas.getContext('2d')!;
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, byte, i) => {
					const s = byte / 255;
					return (
						sum +
						(s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
					);
				}, 0);
			}
			const background = luminance(
				getComputedStyle(document.querySelector('.discussion-panel')!).backgroundColor
			);
			return entries.map((entry) => {
				const text = luminance(getComputedStyle(entry).color);
				return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
			});
		});
		for (const ratio of ratios) expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
	}
});

test('mobile note inspector keeps one editor and screen-sized actions without losing drafts', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const card = page.locator('[data-note-id]').first();
	await card
		.getByRole('textbox', { name: 'Note content', exact: true })
		.evaluate((el) => el.setAttribute('data-editor-identity', 'retained'));
	await card.locator('[data-note-inspect]').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('[data-note-inspector-close]')).toBeFocused();
	await expect(page.locator('[data-note-id]')).toHaveCount(1);
	await card.getByRole('heading', { level: 1 }).fill('Mobile unsaved words');
	const save = card.getByRole('button', { name: 'Save note', exact: true });
	const size = (await save.boundingBox())!;
	expect(size.width).toBeGreaterThanOrEqual(44);
	expect(size.height).toBeGreaterThanOrEqual(44);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(card.locator('[data-note-inspect]')).toBeFocused();
	await card.locator('[data-note-inspect]').click();
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Mobile unsaved words');
	await expect(card.getByRole('textbox', { name: 'Note content', exact: true })).toHaveAttribute(
		'data-editor-identity',
		'retained'
	);
	await card.getByText('Canvas position and size', { exact: true }).click();
	await card.getByRole('button', { name: 'Move note right', exact: true }).click();
	await card.getByLabel('Width', { exact: true }).fill('500');
	await card.getByLabel('Width', { exact: true }).press('Tab');
	await expect(card).toHaveAttribute('data-width', '500');
	await expect(card.getByRole('heading', { level: 1 })).toHaveText('Mobile unsaved words');
	await expect(card.locator('.conflict')).toHaveCount(0);
	await save.click();
	await expect(card.locator('.unsaved')).toHaveCount(0);
	await card.locator('[data-note-inspector-close]').click();
	await expect(dialog).toHaveCount(0);
});

test('mobile discussion keeps its composer usable in short and landscape viewports', async ({
	page
}) => {
	await page.goto('/v2');
	await page
		.getByTestId('initial-topic')
		.fill(
			'A long proposition that must stay readable on a narrow screen without entering edit mode'
		);
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.setViewportSize({ width: 390, height: 844 });
	if (await page.getByTestId('audio-options').count()) {
		await page.getByTestId('audio-options').click();
		const options = page.locator('.experimental-audio-panel');
		await expect(options).toBeVisible();
		const bounds = (await options.boundingBox())!;
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
		await page.keyboard.press('Escape');
	}
	for (const viewport of [
		{ width: 390, height: 480 },
		{ width: 844, height: 390 }
	]) {
		await page.setViewportSize(viewport);
		await page.getByTestId('discussion-toggle').click();
		await expect(page.getByTestId('discussion-tab-chat')).toHaveAttribute('aria-selected', 'true');
		expect(
			await page.getByTestId('canvas-viewport').evaluate((el) => (el as HTMLElement).inert)
		).toBe(true);
		expect(await page.locator('.v2-topbar').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
		const input = page.getByLabel('Chat message', { exact: true });
		await input.fill('A retained mobile draft');
		const bounds = (await input.boundingBox())!;
		expect(bounds.height).toBeGreaterThanOrEqual(44);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
		await page.getByTestId('discussion-close').click();
		await expect(page.getByTestId('discussion-toggle')).toBeFocused();
		expect(
			await page.getByTestId('canvas-viewport').evaluate((el) => (el as HTMLElement).inert)
		).toBe(false);
	}
	await page.getByTestId('edit-claim').click();
	await expect(page.getByTestId('claim-input')).toBeFocused();
	await page.getByTestId('claim-input').fill('A new proposition');
	await page.keyboard.press('Control+Enter');
	await expect(page.getByTestId('room-claim').getByRole('heading')).toHaveText('A new proposition');
});

test('room controls wait for fresh authority after reconnect, not only socket signin', async ({
	page
}) => {
	let delayRoom = false;
	let interrupt: () => void = () => {
		throw new Error('Missing connection');
	};
	const queued: (() => void)[] = [];
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		interrupt = () => socket.close({ code: 1012, reason: 'Controlled authority refresh' });
		server.onMessage((raw) => {
			const isRoomState = String(raw)
				.split(/\r?\n/)
				.filter(Boolean)
				.some((line) => JSON.parse(line).op === 'room.state');
			if (delayRoom && (isRoomState || queued.length > 0)) queued.push(() => socket.send(raw));
			else socket.send(raw);
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	delayRoom = true;
	interrupt();
	await expect(page.getByTestId('new-note')).toBeDisabled();
	await expect.poll(() => queued.length, { timeout: 15000 }).toBeGreaterThan(0);
	await expect(page.getByTestId('connection-state')).toHaveAttribute('data-status', 'Connected');
	await expect(page.getByTestId('new-note')).toBeDisabled();
	await expect(page.getByTestId('edit-claim')).toBeDisabled();
	delayRoom = false;
	for (const deliver of queued.splice(0)) deliver();
	await expect(page.getByTestId('new-note')).toBeEnabled();
	await expect(page.getByTestId('edit-claim')).toBeEnabled();
});

test('note dock stays inside the canvas at an edge and after opening Discussion', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	await expect(note).toBeVisible();
	await page.getByTestId('connection-state').click();
	const canvas = page.getByTestId('canvas-viewport');
	const boundary = (await canvas.boundingBox())!;
	const card = (await note.boundingBox())!;
	const heading = (await note.getByRole('heading', { level: 1 }).boundingBox())!;
	const dx = boundary.x + boundary.width - card.width - 12 - card.x;
	const dy = boundary.y + boundary.height - card.height - 12 - card.y;
	await page.mouse.move(heading.x + 20, heading.y + 10);
	await page.mouse.down();
	await page.mouse.move(heading.x + 20 + dx, heading.y + 10 + dy, { steps: 8 });
	await page.mouse.up();
	await note.hover();
	const dock = note.locator('.note-tools');
	await expect(note).toHaveAttribute('data-dock-placement', 'above');
	const reveal = dock.getByRole('button', { name: 'Reveal', exact: true });
	await reveal.hover();
	const hit = (await reveal.boundingBox())!;
	await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
	await page.mouse.down();
	// Let focus and ResizeObserver run while the button remains held down.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	const held = (await reveal.boundingBox())!;
	// Hover lift may move by a pixel; expanding advanced controls must not
	// shift the action by an entire row between pointerdown and pointerup.
	expect(Math.abs(held.y - hit.y)).toBeLessThan(2);
	await page.mouse.up();
	await expect(dock.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
	async function contained() {
		const region = (await canvas.boundingBox())!;
		const tools = (await dock.boundingBox())!;
		return (
			tools.x >= region.x &&
			tools.y >= region.y &&
			tools.x + tools.width <= region.x + region.width + 1 &&
			tools.y + tools.height <= region.y + region.height - 50
		);
	}
	await expect.poll(contained).toBe(true);
	await page.getByTestId('discussion-toggle').click();
	await note.getByRole('textbox', { name: 'Note content', exact: true }).focus();
	await expect.poll(contained).toBe(true);
	await dock.getByRole('button', { name: 'Pin note', exact: true }).click();
	await expect(note).toHaveAttribute('data-pinned', 'true');
});

test('toolbar popovers remain reachable in short and narrow viewports', async ({ page }) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	for (const viewport of [
		{ width: 1280, height: 450 },
		{ width: 720, height: 450 },
		{ width: 320, height: 568 }
	]) {
		await page.setViewportSize(viewport);
		for (const trigger of [
			page.getByTitle('People', { exact: true }),
			page.getByLabel('Room options', { exact: true }),
			page.getByTestId('app-menu'),
			page.getByLabel('Session actions', { exact: true })
		]) {
			await trigger.click();
			const panel = page.locator('details[name="room-toolbar"][open] > .toolbar-popover');
			await expect(panel).toBeVisible();
			await expect
				.poll(async () => {
					const rect = (await panel.boundingBox())!;
					return (
						rect.x >= 0 &&
						rect.y >= 0 &&
						rect.x + rect.width <= viewport.width + 1 &&
						rect.y + rect.height <= viewport.height + 1
					);
				})
				.toBe(true);
			await panel.locator('button:not([disabled]), select, input').last().focus();
			await page.keyboard.press('Escape');
			await expect(trigger).toBeFocused();
		}
	}
});

test('claim editing cancels with Escape and never restores a draft after an authority change', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('initial-topic').fill('Original shared proposition');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('edit-claim').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('edit-claim')).toBeFocused();
	await page.getByTestId('edit-claim').click();
	await page.getByTestId('claim-input').fill('Cancelled text');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByTestId('edit-claim')).toBeFocused();
	await page.getByTestId('edit-claim').click();
	await page.getByTestId('claim-input').fill('Discarded by Escape');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('edit-claim')).toBeFocused();
	await expect(page.getByTestId('room-claim')).not.toContainText('Discarded by Escape');
	await expect(page.getByTestId('room-claim')).toContainText('Original shared proposition');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const next = await context.newPage();
		await next.goto(page.url());
		await expect(next.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Promote / }).click();
		await page.getByTitle('People', { exact: true }).click();
		await page.getByTestId('edit-claim').click();
		await page.getByTestId('claim-input').fill('Draft before revocation');
		await page.getByTitle('People', { exact: true }).click();
		// Appointment is additive, so the draft survives until the caller also
		// steps down, which is the moment administration actually moves.
		await page.getByRole('button', { name: /^Make .+ admin$/ }).click();
		await page.getByTestId('confirm-session-action').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await expect(next.getByTestId('own-role')).toHaveText('admin');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Give up my admin rights', exact: true }).click();
		await page.getByTestId('confirm-session-action').click();
		await expect(page.getByTestId('own-role')).toHaveText('participant');
		await expect(page.getByTestId('claim-input')).toHaveCount(0);
		await expect(page.getByTestId('room-claim')).not.toContainText('Draft before revocation');
		await next.getByTitle('People', { exact: true }).click();
		await next.getByRole('button', { name: /^Make .+ admin$/ }).click();
		await next.getByTestId('confirm-session-action').click();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await page.getByTestId('edit-claim').click();
		await expect(page.getByTestId('claim-input')).toHaveValue('Original shared proposition');
	} finally {
		await context.close();
	}
});

test('spectrum labels stay above collision highlight and own marker keeps a readable label', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const labels = page.getByTestId('spectrum-labels');
	await expect(labels).toBeVisible();
	await expect
		.poll(() =>
			labels.evaluate(
				(el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0
			)
		)
		.toBe(true);
	const own = page.getByRole('button', { name: 'Your position', exact: true });
	await expect(own.locator('.own-label')).toContainText('You');
	const levels = await page.evaluate(() =>
		['.cell-highlight', '.spectrum-labels', '.pellet.own'].map((selector) =>
			Number(getComputedStyle(document.querySelector(selector)!).zIndex)
		)
	);
	expect(levels[1]).toBeGreaterThan(levels[0]);
	expect(levels[2]).toBeGreaterThan(levels[1]);
	const before = (await own.locator('.own-label').boundingBox())!.width;
	await page.getByRole('button', { name: 'Zoom −', exact: true }).click();
	await page.getByRole('button', { name: 'Zoom −', exact: true }).click();
	expect(Math.abs((await own.locator('.own-label').boundingBox())!.width - before)).toBeLessThan(1);
});

test('note dock fades separately from themed cards and native selects use centered text metrics', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	const note = page.locator('[data-note-id]').first();
	const colors = [];
	for (const theme of ['light', 'dark']) {
		await page.getByTestId('app-menu').click();
		await page.getByTestId('theme-select').selectOption(theme);
		await page.keyboard.press('Escape');
		colors.push(await note.evaluate((el) => getComputedStyle(el).backgroundColor));
	}
	expect(colors[0]).not.toBe(colors[1]);
	await note.hover();
	const dock = note.locator('.note-tools');
	await expect.poll(() => dock.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
	expect(await dock.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
		'rgba(0, 0, 0, 0)'
	);
	expect(
		await note.locator('.note-topbar').evaluate((el) => getComputedStyle(el).backgroundColor)
	).toBe('rgba(0, 0, 0, 0)');
	const metrics = await page.locator('select:not([multiple])').evaluateAll((elements) =>
		elements.map((el) => ({
			paddingTop: getComputedStyle(el).paddingTop,
			paddingBottom: getComputedStyle(el).paddingBottom,
			lineHeight: getComputedStyle(el).lineHeight
		}))
	);
	for (const metric of metrics)
		expect(metric).toEqual({ paddingTop: '0px', paddingBottom: '0px', lineHeight: 'normal' });
	await page.mouse.move(0, 0);
	await expect(dock).toBeHidden();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await note.hover();
	expect(await dock.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
	await page.setViewportSize({ width: 390, height: 844 });
	await note.locator('[data-note-inspect]').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(colors[1]);
	await dialog.locator('[data-note-inspector-close]').click();
});

test('missing room has actionable French copy inside the lobby', async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'fr', domain: 'localhost', path: '/' }]);
	await page.goto('/v2?room=OSR-MISSING-UI-AUDIT');
	await expect(page.getByRole('alert')).toContainText('Cette salle est indisponible');
	await expect(page.locator('.lobby-card').getByRole('alert')).toBeVisible();
	await expect(page.getByTestId('create-room')).toBeVisible();
	await expect(page.getByTestId('create-instead')).toBeVisible();
});

test('lobby remembers the last room, offers v1 and follows the system theme', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/v2');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const roomId = (await page.locator('.room-code').textContent())?.trim() ?? '';
	expect(roomId).toMatch(/^OSR-[A-Z0-9]{4,64}$/);
	await expect(page).toHaveTitle(`Spectrum v2 · ${roomId}`);
	await page.goto('/v2');
	await expect(page.getByTestId('recent-room')).toContainText(roomId);
	await page.getByTestId('app-menu').click();
	await expect(page.getByTestId('back-to-v1')).toHaveAttribute('href', '/');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('back-to-v1')).toBeHidden();
	await page.getByTestId('recent-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.goto('/v2');
	await page.getByTestId('forget-recent').click();
	await expect(page.getByTestId('recent-room')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('recent-room')).toHaveCount(0);
});

test('room sharing generates a local QR, presentation hides controls, and preferences survive reload', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('initial-topic').fill('A shared claim');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const url = page.url();
	await page.getByRole('button', { name: 'Invite', exact: true }).click();
	await expect(page.getByTestId('share-link')).toHaveValue(url);
	await expect(page.getByTestId('share-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeFocused();
	await page.getByTestId('app-menu').click();
	await page.getByRole('button', { name: 'Help', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('microphone');
	await expect(page.getByRole('dialog')).toContainText('RAM, not saved to disk');
	await expect(
		page.getByRole('dialog').getByRole('link', { name: 'Feedback · Google Form', exact: true })
	).toHaveAttribute(
		'href',
		'https://docs.google.com/forms/d/e/1FAIpQLSd8shcmOiQ-asItxqCfYUpi5-XFmK07DKo2y9t3hvy_hNG7Wg/viewform?usp=header'
	);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByTestId('app-menu').click();
	await page.getByTestId('theme-select').selectOption('dark');
	await expect(page.getByTestId('feedback-link')).toHaveText('Feedback · Google Form');
	await expect(page.getByTestId('feedback-link')).toHaveAttribute('target', '_blank');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByTestId('presentation-toggle').click();
	await expect(page.getByTestId('presentation-exit')).toBeVisible();
	await expect(page.getByTestId('new-note')).toBeHidden();
	await expect(page.getByTestId('room-claim')).toContainText('A shared claim');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('new-note')).toBeVisible();
	await expect(page.getByTestId('app-menu')).toBeFocused();
	await page.getByTestId('app-menu').click();
	await Promise.all([
		page.waitForEvent('domcontentloaded'),
		page.getByTestId('language-select').selectOption('fr')
	]);
	await expect(page.getByTestId('own-role')).toHaveAttribute('data-role', 'admin');
	await expect(page.getByTestId('new-note')).toHaveText('Nouvelle note');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page).toHaveURL(url);
	await page.getByTestId('app-menu').click();
	await page.getByTestId('theme-select').selectOption('lofi');
	await expect(page.getByTestId('feedback-link')).toHaveText('Retours · Formulaire Google');
	await expect(page.getByTestId('feedback-link')).toHaveAttribute(
		'href',
		'https://docs.google.com/forms/d/e/1FAIpQLSd53Jkrxa0l1Vcp4rTtrRlSJ8d7Vxx42EiMz0esjAvVSmvLNg/viewform?usp=header'
	);
	await page.getByTestId('language-select').selectOption('en');
	await expect(page.getByTestId('new-note')).toHaveText('New note');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'lofi');
});

test('presentation hides private notes and pellets while preserving unsaved drafts', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByTestId('new-note').click();
	await page.getByLabel('Room options', { exact: true }).click();
	await page.getByLabel("Hide everyone's positions", { exact: true }).check();
	await page.getByLabel('Room options', { exact: true }).click();
	await expect(page.locator('[data-pellet-id]')).toHaveCount(1);
	const note = page.locator('[data-note-id]').first();
	await note.getByRole('heading', { level: 1 }).fill('Private unsaved draft');
	await page.getByTestId('app-menu').click();
	await page.getByTestId('presentation-toggle').click();
	await expect(note).toBeHidden();
	await expect(page.locator('[data-pellet-id]')).toHaveCount(0);
	await expect(page.getByTestId('presentation-exit')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(note.getByRole('heading', { level: 1 })).toHaveText('Private unsaved draft');
	await expect(page.locator('[data-pellet-id]')).toHaveCount(1);
	await note.hover();
	await note.getByRole('button', { name: 'Save note', exact: true }).click();
	await expect(note.locator('.unsaved')).toHaveCount(0);
	await note.getByRole('button', { name: 'Approve', exact: true }).click();
	await note.getByRole('button', { name: 'Reveal', exact: true }).click();
	await page.getByLabel('Room options', { exact: true }).click();
	await page.getByLabel('Show revealed notes to spectators').check();
	await page.getByLabel('Room options', { exact: true }).click();
	await page.getByTestId('app-menu').click();
	await page.getByTestId('presentation-toggle').click();
	await expect(note).toBeVisible();
	await page.getByTestId('presentation-exit').click();
	await expect(page.getByTestId('app-menu')).toBeFocused();
	await expect(note.getByRole('textbox')).toHaveAttribute('contenteditable', 'true');
	await note.getByRole('heading', { level: 1 }).fill('Unpublished change');
	await expect(note.locator('.unsaved')).toBeVisible();
	await page.getByTestId('app-menu').click();
	await page.getByTestId('presentation-toggle').click();
	await expect(note).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(note.getByRole('heading', { level: 1 })).toHaveText('Unpublished change');
});

test('live controls display votes, select external pellets and disconnect using protocol fixtures', async ({
	page
}) => {
	let spectrum: SpectrumState | null = null;
	let connected = false;
	let selected = false;
	let sends: (() => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		const scene = () => {
			if (!spectrum) throw new Error('Missing spectrum fixture');
			return {
				...spectrum,
				pellets: [
					...spectrum.pellets,
					...(connected
						? [
								{
									memberId: 'live_average',
									nickname: 'twitch',
									color: '9146ff',
									x: 490,
									y: 100,
									version: 1
								},
								...(selected
									? [
											{
												memberId: 'l_fixture',
												nickname: '<script>Alice</script>',
												color: '9146ff',
												x: 490,
												y: 100,
												version: 1
											}
										]
									: [])
							]
						: [])
				]
			};
		};
		const live = () => ({
			roomId: new URL(page.url()).searchParams.get('room'),
			revision: spectrum?.revision ?? 0,
			status: connected ? 'connected' : 'disconnected',
			platform: connected ? 'twitch' : undefined,
			count: connected ? 1 : 0,
			limit: 1000,
			tiktokAvailable: false,
			users: connected
				? [{ id: 'l_fixture', nickname: '<script>Alice</script>', vote: 0, selected }]
				: []
		});
		sends = () => {
			socket.send(JSON.stringify({ v: 2, op: 'live.snapshot', payload: live() }));
			socket.send(JSON.stringify({ v: 2, op: 'spectrum.snapshot', payload: scene() }));
		};
		socket.onMessage((raw) => {
			const event = JSON.parse(String(raw));
			if (event.op === 'live.connect') {
				expect(event.payload.platform).toBe('twitch');
				connected = true;
				sends?.();
			} else if (event.op === 'live.select') {
				selected = event.payload.selected;
				sends?.();
			} else if (event.op === 'live.disconnect') {
				connected = false;
				sends?.();
			} else server.send(raw);
		});
		server.onMessage((raw) => {
			for (const line of String(raw).split(/\r?\n/).filter(Boolean)) {
				const event = JSON.parse(line);
				if (event.op === 'room.state') {
					spectrum = event.payload.spectrum;
					event.payload.spectrum = scene();
				}
				if (event.op === 'spectrum.snapshot') {
					spectrum = event.payload;
					event.payload = scene();
				}
				if (event.op === 'live.snapshot') event.payload = live();
				socket.send(JSON.stringify(event));
			}
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByLabel('Live platforms', { exact: true }).click();
	await expect(page.getByTestId('live-platform').locator('option[value="tiktok"]')).toHaveAttribute(
		'disabled',
		''
	);
	await page.getByTestId('live-platform').selectOption('youtube');
	await page.getByTestId('live-panel').locator('input[type="password"]').fill('temporary-fixture');
	await page.getByTestId('live-platform').selectOption('twitch');
	await page.getByTestId('live-platform').selectOption('youtube');
	await expect(page.getByTestId('live-panel').locator('input[type="password"]')).toHaveValue('');
	await page.getByTestId('live-platform').selectOption('twitch');
	await page.getByTestId('live-channel').fill('example_channel');
	await page.getByRole('button', { name: 'Connect Live', exact: true }).click();
	await expect(page.getByTestId('live-panel')).toContainText('<script>Alice</script>');
	await expect(page.getByTestId('live-panel').locator('script')).toHaveCount(0);
	await expect(page.locator('[data-pellet-id="live_average"]')).toBeVisible();
	await page
		.getByRole('checkbox', { name: 'Show <script>Alice</script> on the spectrum', exact: true })
		.check();
	await expect(page.locator('[data-pellet-id="l_fixture"]')).toBeVisible();
	await page.getByRole('button', { name: 'Disconnect live', exact: true }).click();
	await expect(
		page.locator('[data-pellet-id="l_fixture"], [data-pellet-id="live_average"]')
	).toHaveCount(0);
});

async function openPeople(client: Page) {
	const panel = client.getByTestId('people-panel');
	if (!(await panel.isVisible())) await client.getByTitle('People', { exact: true }).click();
	await expect(panel).toBeVisible();
}

async function confirmSession(page: Page) {
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByTestId('confirm-session-action').click();
}

test('session controls appoint co-admins, let an admin step down, and close rooms', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	const observerContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await context.newPage();
		const observer = await observerContext.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByTitle('People', { exact: true }).click();
		await guest.getByLabel('Your pseudonym').fill('Next admin');
		await guest.getByLabel('Save pseudonym', { exact: true }).click();
		await guest.getByTitle('People', { exact: true }).click();
		await openPeople(page);
		await page.getByLabel('Promote Next admin', { exact: true }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		// The only admin cannot step down before naming somebody else.
		await expect(page.getByLabel('Give up my admin rights')).toHaveCount(0);
		await page.getByLabel('Make Next admin admin', { exact: true }).click();
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		await openPeople(page);
		await page.getByLabel('Make Next admin admin', { exact: true }).click();
		await confirmSession(page);
		// Appointment is additive: the caller keeps administration.
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await expect(guest.getByTestId('own-role')).toHaveText('admin');
		await openPeople(page);
		await page.getByLabel('Give up my admin rights', { exact: true }).click();
		await confirmSession(page);
		await expect(page.getByTestId('own-role')).toHaveText('participant');
		await openPeople(page);
		await expect(page.getByLabel('Make Next admin admin')).toHaveCount(0);
		await observer.goto(guest.url());
		await expect(observer.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByTitle('People', { exact: true }).click();
		const spectatorRow = guest
			.getByTestId('people-panel')
			.locator('[data-member-id]')
			.filter({ has: guest.getByRole('button', { name: /^Promote / }) });
		await spectatorRow.getByRole('button', { name: /^Remove / }).click();
		await confirmSession(guest);
		await expect(observer.getByTestId('create-room')).toBeVisible();
		await expect(observer).not.toHaveURL(/room=/);
		await guest.getByTitle('People', { exact: true }).click();
		await guest
			.getByTestId('people-panel')
			.getByRole('button', { name: /^Remove / })
			.click();
		await confirmSession(guest);
		await expect(page.getByTestId('create-room')).toBeVisible();
		await page.reload();
		await expect(page.getByTestId('create-room')).toBeEnabled();
		await guest.getByLabel('Session actions', { exact: true }).click();
		await guest.getByRole('button', { name: 'End session', exact: true }).click();
		await confirmSession(guest);
		await expect(guest.getByTestId('create-room')).toBeVisible();
		await expect(guest.getByRole('alert')).toHaveCount(0);
	} finally {
		await context.close();
		await observerContext.close();
	}
});

test('leaving hands administration to remaining stage member and last admin closes spectator-only room', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await context.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Promote / }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		await page.getByLabel('Session actions', { exact: true }).click();
		await page.getByRole('button', { name: 'Leave room', exact: true }).click();
		await confirmSession(page);
		await expect(page.getByTestId('create-room')).toBeVisible();
		await expect(guest.getByTestId('own-role')).toHaveText('admin');
		await page
			.getByLabel('Room ID', { exact: true })
			.fill(new URL(guest.url()).searchParams.get('room')!);
		await page.getByTestId('join-room').click();
		await expect(page.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByLabel('Session actions', { exact: true }).click();
		await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
		await confirmSession(guest);
		await expect(guest.getByTestId('create-room')).toBeVisible();
		await expect(page.getByTestId('create-room')).toBeVisible();
	} finally {
		await context.close();
	}
});

test('backend rejects spectator reactions even when the UI restriction is bypassed', async ({
	page
}) => {
	let socketURL = '';
	page.on('websocket', (socket) => {
		if (socket.url().includes('/spectrum/ws')) socketURL = socket.url();
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const roomId = new URL(page.url()).searchParams.get('room');
	expect(roomId).toBeTruthy();
	expect(socketURL).not.toBe('');
	const outcome = await page.evaluate(
		async ({ id, url }) => {
			interface Message {
				procedure?: string;
				arguments?: string[];
				v?: number;
				op?: string;
				payload?: { code?: string };
			}
			// Reuse the app's actual API origin so isolated backend ports work too.
			const socket = new WebSocket(url);
			const messages: Message[] = [];
			socket.onmessage = (event) => {
				for (const line of String(event.data).split(/\r?\n/).filter(Boolean))
					messages.push(JSON.parse(line) as Message);
			};
			async function waitFor(match: (message: Message) => boolean, timeout = 5000) {
				const started = performance.now();
				while (performance.now() - started < timeout) {
					const found = messages.find(match);
					if (found) return found;
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
				throw new Error(`Timed out waiting for server message: ${JSON.stringify(messages)}`);
			}
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
				socket.onopen = () => {
					clearTimeout(timeout);
					resolve();
				};
				socket.onerror = () => {
					clearTimeout(timeout);
					reject(new Error('WebSocket failed'));
				};
			});
			socket.send(JSON.stringify({ procedure: 'signin', arguments: [crypto.randomUUID()] }));
			await waitFor(
				(message) => message.procedure === 'ack' && message.arguments?.[0] === 'signin'
			);
			socket.send(JSON.stringify({ v: 2, op: 'room.join', payload: { roomId: id } }));
			await waitFor((message) => message.v === 2 && message.op === 'room.state');
			socket.send(JSON.stringify({ v: 2, op: 'room.react', payload: { emoji: '👍' } }));
			const response = await waitFor(
				(message) => message.v === 2 && (message.op === 'error' || message.op === 'room.reaction')
			);
			socket.close();
			return response;
		},
		{ id: roomId, url: socketURL }
	);
	expect(outcome).toMatchObject({ op: 'error', payload: { code: 'reaction_failed' } });
});

test('spectator hands synchronize across reloads, admin lowers them, and reactions expire', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await context.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByTestId('hand-toggle').click();
		await expect(guest.getByTestId('hand-toggle')).toHaveAttribute('aria-pressed', 'true');
		await page.getByTitle('People', { exact: true }).click();
		await expect(page.getByTestId('hand-queue').locator('[data-hand-member]')).toHaveCount(1);
		await guest.reload();
		await expect(guest.getByTestId('hand-toggle')).toHaveAttribute('aria-pressed', 'true');
		await page.getByTestId('hand-queue').getByRole('button').click();
		await expect(guest.getByTestId('hand-toggle')).toHaveAttribute('aria-pressed', 'false');
		await expect(guest.getByLabel('Reactions', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: /^Promote / }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		await guest.getByLabel('Reactions', { exact: true }).click();
		await guest.getByRole('button', { name: 'React 👍', exact: true }).click();
		await expect(page.getByTestId('room-reactions')).toContainText('👍');
		expect(
			await page
				.getByTestId('room-reactions')
				.locator('.reaction-emoji')
				.evaluate((el) => getComputedStyle(el).animationName)
		).toMatch(/reaction-pop$/);
		expect(
			await guest.getByTestId('hand-toggle').evaluate((el) => getComputedStyle(el).animationName)
		).toBe('none');
		await expect(page.getByTestId('room-reactions').locator('[data-reaction-member]')).toHaveCount(
			0,
			{ timeout: 7000 }
		);
		await page.getByRole('button', { name: /^Demote / }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await expect(guest.getByLabel('Reactions', { exact: true })).toHaveCount(0);
		await guest.reload();
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await expect(guest.getByTestId('room-reactions').locator('[data-reaction-member]')).toHaveCount(
			0
		);
	} finally {
		await context.close();
	}
});

async function moveActivityPellet(page: Page, x: number, y: number) {
	const own = page.getByRole('button', { name: 'Your position', exact: true });
	const box = await own.boundingBox();
	if (!box) throw new Error('Missing own pellet');
	const scale = box.width / 28;
	const fromX = Number(await own.getAttribute('data-x'));
	const fromY = Number(await own.getAttribute('data-y'));
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		box.x + box.width / 2 + (x - fromX) * scale,
		box.y + box.height / 2 + (y - fromY) * scale,
		{ steps: 8 }
	);
	await page.mouse.up();
}

test('personal notes stay on this device and survive reload and room switch', async ({
	page,
	browser
}) => {
	const sent: string[] = [];
	page.on('websocket', (socket) => {
		if (socket.url().includes('/spectrum/ws'))
			socket.on('framesent', ({ payload }) => sent.push(String(payload)));
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await openPrivateNotes(page);
	const input = page.getByTestId('personal-notes-input');
	await input.fill('Private reminder: ask about parking');
	await expect(page.getByTestId('personal-notes-status')).toHaveText('Saved on this device');
	const roomId = new URL(page.url()).searchParams.get('room');
	expect(sent.join('\n')).not.toContain('Private reminder');
	await expect(page.locator('[data-note-id]')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await openPrivateNotes(page);
	await expect(page.getByTestId('personal-notes-input')).toHaveValue(
		'Private reminder: ask about parking'
	);
	// A second Spectrum starts empty and cannot read the first room's notes.
	const otherContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const other = await otherContext.newPage();
		await other.goto('/v2');
		await other.getByTestId('create-room').click();
		await expect(other.getByTestId('own-role')).toHaveText('admin');
		await openPrivateNotes(other);
		await expect(other.getByTestId('personal-notes-input')).toHaveValue('');
		expect(new URL(other.url()).searchParams.get('room')).not.toBe(roomId);
	} finally {
		await otherContext.close();
	}
});

test('private notes open in a dedicated panel outside discussion', async ({ page }) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const panel = page.getByTestId('personal-notes-panel');
	await openPrivateNotes(page);
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('discussion-panel')).toBeHidden();
	await expect(panel.getByTestId('personal-notes-input')).toBeFocused();
	await page.getByTestId('discussion-toggle').click();
	await expect(panel).toBeHidden();
	await expect(page.getByTestId('discussion-panel')).toBeVisible();
	await expect(page.getByTestId('discussion-tab-notes')).toHaveCount(0);
	await page.getByTestId('discussion-close').click();
	await expect(page.getByTestId('discussion-toggle')).toBeFocused();
	await page.getByTestId('personal-notes-toggle').click();
	await expect(panel).toBeVisible();
	await page.getByTestId('personal-notes-close').click();
	await expect(panel).toBeHidden();
	await expect(page.getByTestId('personal-notes-toggle')).toBeFocused();
});

test('discussion dock preserves drafts, supports keyboard tabs and restores focus', async ({
	page
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const canvas = page.getByTestId('canvas-viewport');
	const fullWidth = (await canvas.boundingBox())!.width;
	await openChat(page);
	await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(fullWidth);
	const input = page.getByLabel('Chat message', { exact: true });
	await input.fill('Keep this unsent draft');
	await page.getByTestId('discussion-tab-chat').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('discussion-tab-activity')).toBeFocused();
	await expect(page.getByTestId('discussion-tab-activity')).toHaveAttribute(
		'aria-selected',
		'true'
	);
	// Transcription is opt-in, so the visible tab list can vary by deployment;
	// End must reach the last available tab and Home the first.
	await page.keyboard.press('End');
	await expect(page.getByTestId('discussion-panel').getByRole('tab').last()).toBeFocused();
	await page.keyboard.press('Home');
	await expect(input).toHaveValue('Keep this unsent draft');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('discussion-panel')).toBeHidden();
	await expect(page.getByTestId('discussion-toggle')).toBeFocused();
	await openChat(page);
	await expect(input).toHaveValue('Keep this unsent draft');
	await page.setViewportSize({ width: 390, height: 844 });
	// roomViewport updates visualViewport bounds on the next animation frame.
	// Wait for that layout, not the preceding desktop CSS variable values.
	await expect
		.poll(async () => {
			const bounds = await page.getByTestId('discussion-panel').boundingBox();
			return bounds ? bounds.x + bounds.width : Infinity;
		})
		.toBeLessThanOrEqual(390);
	const panel = (await page.getByTestId('discussion-panel').boundingBox())!;
	expect(panel.x).toBeGreaterThanOrEqual(0);
	expect(panel.x + panel.width).toBeLessThanOrEqual(390);
	expect(panel.y + panel.height).toBeLessThanOrEqual(844);
	await page.getByTestId('discussion-close').click();
	await expect(page.getByTestId('discussion-toggle')).toBeFocused();
	await openChat(page);
	await expect(input).toHaveValue('Keep this unsent draft');
});

test('inline Markdown notes and actions synchronize across browser engines', async ({
	page,
	browserName
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await expect(page).toHaveURL(/room=/);
	const spectatorBrowser = await (browserName === 'firefox' ? chromium : firefox).launch();
	const spectator = await spectatorBrowser.newPage();
	await isolateExternalStyles(spectator.context());
	spectator.on('pageerror', (error) => errors.push(error.message));
	try {
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await expect(spectator.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'New note', exact: true }).click();
		const cards = page.locator('[data-note-id]');
		const spectatorCards = spectator.locator('[data-note-id]');
		await expect(cards).toHaveCount(1);
		await expect(spectatorCards).toHaveCount(0);
		const first = cards.first();
		await expect(first.getByRole('heading', { level: 1 })).toHaveText('');
		await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0);
		await expect(page.getByTestId('discussion-panel')).toBeHidden();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.mouse.move(5, 200);
		await expect(first.getByRole('button', { name: 'Reveal', exact: true })).toBeHidden();
		await first.hover();
		await expect(first.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
		await expect(first.getByRole('button', { name: 'H1', exact: true })).toBeVisible();
		await expect(first.getByRole('heading', { name: 'Edit', exact: true })).toBeVisible();
		await first.getByRole('heading', { level: 1 }).fill('First argument');
		await expect(first.getByRole('button', { name: 'H1', exact: true })).toBeVisible();
		await expect(first.getByText('Unsaved', { exact: true })).toBeVisible();
		// A snapshot arriving while editing must not destroy the draft or focus.
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Show revealed notes to spectators').check();
		await page.getByLabel('Room options', { exact: true }).click();
		await first.hover();
		await expect(first.getByRole('heading', { level: 1 })).toHaveText('First argument');
		await first.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(first).toHaveAttribute('aria-label', 'First argument');
		await expect(first.getByText('Unsaved', { exact: true })).toHaveCount(0);
		await first.getByRole('button', { name: 'Approve', exact: true }).click();
		await first.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectatorCards).toHaveCount(1);
		await expect(spectatorCards.first().getByRole('heading', { level: 1 })).toHaveText(
			'First argument'
		);
		await expect(
			spectatorCards.first().getByRole('textbox', { name: 'Note content' })
		).toHaveAttribute('contenteditable', 'false');
		await expect(
			spectatorCards.first().getByRole('button', { name: 'Save note', exact: true })
		).toHaveCount(0);
		await page.getByRole('button', { name: 'New note', exact: true }).click();
		await expect(cards).toHaveCount(2);
		const second = cards.last();
		await second.hover();
		await second.getByRole('heading', { level: 1 }).fill('Second argument');
		await second.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(second.locator('.unsaved')).toHaveCount(0);
		await second.getByRole('button', { name: 'Approve', exact: true }).click();
		await second.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectatorCards).toHaveCount(2);
		await expect(second.getByRole('heading', { name: 'Arrange', exact: true })).toBeVisible();
		await expect(second.getByRole('heading', { name: 'Moderation', exact: true })).toBeVisible();
		await expect(second.getByRole('heading', { name: 'Link', exact: true })).toBeVisible();
		await second.getByText('Link a note', { exact: true }).click();
		const targetSearch = second.getByRole('searchbox', {
			name: 'Search by title, author or excerpt',
			exact: true
		});
		await targetSearch.fill('absent');
		await expect(
			second.getByText('No matching notes. Try another word or clear the search.')
		).toBeVisible();
		await targetSearch.fill('first');
		await second.getByRole('radio', { name: /First argument/ }).check();
		await second.getByRole('button', { name: 'Create link', exact: true }).click();
		await expect(spectator.getByTestId('canvas-status')).toContainText('Links: 1');
		// An unfocused note drags from its text without a handle or editor focus.
		await page.getByTestId('connection-state').click();
		await expect(page.getByRole('button', { name: 'Move note', exact: true })).toHaveCount(0);
		const handle = await second.getByRole('heading', { level: 1 }).boundingBox();
		if (!handle) throw new Error('Missing note content');
		const before = await second.boundingBox();
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 30, {
			steps: 8
		});
		await page.mouse.up();
		await expect
			.poll(async () => (await second.boundingBox())?.x)
			.toBeGreaterThan((before?.x ?? 0) + 20);
		await expect
			.poll(async () => {
				const [shot, remote] = await Promise.all([
					second.getAttribute('style'),
					spectatorCards.last().getAttribute('style')
				]);
				return ['left', 'top', 'width', 'height'].every(
					(property) => Math.abs(cssPixels(shot, property) - cssPixels(remote, property)) < 0.02
				);
			})
			.toBe(true);
		await expect(second.getByRole('button', { name: 'H1', exact: true })).toBeVisible();
		// Header dragging also works while editing.
		await second.getByRole('textbox', { name: 'Note content' }).focus();
		const header = second.locator('.note-topbar');
		await expect(header).toHaveCSS(
			browserName === 'webkit' ? '-webkit-user-select' : 'user-select',
			'none'
		);
		await expect(header).toHaveCSS('cursor', 'grab');
		const identity = (await header.boundingBox())!;
		const beforeHeader = (await second.boundingBox())!;
		await page.mouse.move(identity.x + 15, identity.y + 8);
		await page.mouse.down();
		await page.mouse.move(identity.x + 55, identity.y + 28, { steps: 8 });
		await page.mouse.up();
		await expect
			.poll(async () => (await second.boundingBox())!.x)
			.toBeGreaterThan(beforeHeader.x + 20);
		const movedStyle = await second.getAttribute('style');
		// A click (including slight pointer jitter) edits instead of moving.
		const content = await second.getByRole('heading', { level: 1 }).boundingBox();
		if (!content) throw new Error('Missing moved content');
		await page.mouse.move(content.x + 10, content.y + content.height / 2);
		await page.mouse.down();
		await page.mouse.move(content.x + 12, content.y + content.height / 2 + 1);
		await page.mouse.up();
		await expect(second.getByRole('textbox', { name: 'Note content' })).toBeFocused();
		await expect(second).toHaveAttribute('style', movedStyle!);
		// While editing, dragging selects text and leaves the note in place.
		await page.mouse.move(content.x + 2, content.y + content.height / 2);
		await page.mouse.down();
		await page.mouse.move(content.x + 50, content.y + content.height / 2, { steps: 5 });
		await page.mouse.up();
		await expect(second).toHaveAttribute('style', movedStyle!);
		expect(
			await page.evaluate(() => window.getSelection()?.toString().length ?? 0)
		).toBeGreaterThan(0);
		const pin = second.getByRole('button', { name: 'Pin note', exact: true });
		await expect(pin).toHaveAttribute('title', 'Pin note');
		await expect(pin).toHaveText('');
		expect(
			await pin.locator('.iconoir-icon').evaluate((icon) => getComputedStyle(icon).maskImage)
		).not.toBe('none');
		await pin.click();
		await expect(second).toHaveAttribute('data-pinned', 'true');
		await expect(spectatorCards.last()).toHaveAttribute('data-pinned', 'true');
		await page.getByTestId('connection-state').click();
		await page.mouse.move(content.x + 10, content.y + content.height / 2);
		await page.mouse.down();
		await page.mouse.move(content.x + 80, content.y + content.height / 2 + 30, { steps: 5 });
		await page.mouse.up();
		await expect(second).toHaveAttribute('style', movedStyle!);
		await second.getByRole('button', { name: 'Unpin note', exact: true }).click();
		await expect(second).toHaveAttribute('data-pinned', 'false');
		await expect(spectatorCards.last()).toHaveAttribute('data-pinned', 'false');
		await second.getByRole('button', { name: 'Hide', exact: true }).click();
		await expect(spectatorCards).toHaveCount(1);
		await expect(spectator.getByTestId('canvas-status')).toContainText('Links: 0');
		await second.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectatorCards).toHaveCount(2);
		await expect(spectator.getByTestId('canvas-status')).toContainText('Links: 1');
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Show revealed notes to spectators').uncheck();
		await expect(spectatorCards).toHaveCount(0);
		await page.getByLabel('Show revealed notes to spectators').check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(spectatorCards).toHaveCount(2);
		await second.getByRole('textbox', { name: 'Note content' }).click();
		await second.getByRole('button', { name: 'Reject', exact: true }).click();
		await expect(spectatorCards).toHaveCount(1);
		await second.getByRole('button', { name: 'Delete', exact: true }).click();
		await page
			.getByRole('dialog', { name: /^Delete / })
			.getByTestId('confirm-session-action')
			.click();
		await expect(cards).toHaveCount(1);
		await expect(page.getByTestId('canvas-status')).toContainText('Links: 0');
		await page.reload();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await expect(cards).toHaveCount(1);
		await expect(first.getByRole('heading', { level: 1 })).toHaveText('First argument');
		expect(errors).toEqual([]);
	} finally {
		await spectatorBrowser.close();
	}
});

test('admin manages stage and moderates participant proposals without exposing signin identities', async ({
	page,
	browser
}) => {
	const received: string[] = [];
	page.on('websocket', (socket) => {
		if (socket.url().includes('/spectrum/ws'))
			socket.on('framereceived', ({ payload }) => received.push(String(payload)));
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const authorContext = await newRoomContext(browser, { storageState: englishLocale });
	const observerContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const author = await authorContext.newPage();
		const observer = await observerContext.newPage();
		for (const client of [author, observer]) {
			client.on('websocket', (socket) => {
				if (socket.url().includes('/spectrum/ws'))
					socket.on('framereceived', ({ payload }) => received.push(String(payload)));
			});
			await client.goto(page.url());
			await expect(client.getByTestId('own-role')).toHaveText('spectator');
		}
		await author.getByTitle('People', { exact: true }).click();
		await author.getByLabel('Your pseudonym').fill('Alice');
		await author.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
		await author.getByTitle('People', { exact: true }).click();
		await page.getByTitle('People', { exact: true }).click();
		await expect(page.getByRole('heading', { name: 'On stage (1/6)', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Promote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('participant');
		await page.getByTitle('People', { exact: true }).click();
		await author.getByRole('button', { name: 'New note', exact: true }).click();
		const draft = author.locator('[data-note-id]').first();
		await expect(draft).toBeVisible();
		await expect(observer.locator('[data-note-id]')).toHaveCount(0);
		await draft.getByRole('heading', { level: 1 }).fill('Proposal from Alice');
		await draft.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(page.locator('[data-note-id]').first()).toHaveAttribute(
			'aria-label',
			'Proposal from Alice'
		);
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Demote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('spectator');
		await expect(author.locator('[data-note-id]')).toHaveCount(0);
		await expect(author.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'Promote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('participant');
		await expect(draft.getByRole('heading', { level: 1 })).toHaveText('Proposal from Alice');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByLabel('Pending notes (1)', { exact: true }).click();
		await page.getByRole('button', { name: 'Approve Proposal from Alice', exact: true }).click();
		await expect(page.getByLabel('Pending notes (1)', { exact: true })).toHaveCount(0);
		await expect(draft.getByRole('textbox', { name: 'Note content' })).toHaveAttribute(
			'contenteditable',
			'true'
		);
		await expect(observer.locator('[data-note-id]')).toHaveCount(0);
		const approved = page.locator('[data-note-id]').first();
		await approved.hover();
		await approved.getByRole('button', { name: 'Reveal', exact: true }).click();
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Show revealed notes to spectators').check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(
			observer.locator('[data-note-id]').first().getByRole('heading', { level: 1 })
		).toHaveText('Proposal from Alice');
		await expect(approved.locator('[data-note-author]')).toHaveText('By Alice');
		await expect(approved.getByRole('textbox', { name: 'Note content' })).toHaveAttribute(
			'contenteditable',
			'false'
		);
		await expect(approved.getByRole('button', { name: 'Save note', exact: true })).toHaveCount(0);
		await draft.getByRole('heading', { level: 1 }).fill('Revised proposal from Alice');
		await draft.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(draft.locator('.unsaved')).toHaveCount(0);
		await expect(observer.locator('[data-note-id]')).toHaveCount(0);
		await expect(approved).toContainText('pending');
		await approved.getByRole('textbox', { name: 'Note content' }).focus();
		await approved.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(observer.locator('[data-note-id]')).toHaveCount(0);
		await approved.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(
			observer.locator('[data-note-id]').first().getByRole('heading', { level: 1 })
		).toHaveText('Revised proposal from Alice');
		for (const client of [page, author, observer]) {
			const signinID = await client.evaluate(() => sessionStorage.getItem('spectrum-v2-user'));
			expect(signinID).toBeTruthy();
			expect(received.some((frame) => frame.includes(signinID!))).toBe(false);
		}
	} finally {
		await authorContext.close();
		await observerContext.close();
	}
});

test('spectrum positions, topic and visibility stay authoritative across clients', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const participantContext = await newRoomContext(browser, { storageState: englishLocale });
	const spectatorContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const participant = await participantContext.newPage();
		const spectator = await spectatorContext.newPage();
		await participant.goto(page.url());
		await expect(participant.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page
			.getByRole('button', { name: /^Promote / })
			.first()
			.click();
		await page.getByTitle('People', { exact: true }).click();
		await expect(participant.getByTestId('own-role')).toHaveText('participant');
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(2);
		await page.getByTestId('edit-claim').click();
		await page.getByTestId('claim-input').fill('What would change your mind?');
		await page.getByTestId('save-claim').click();
		await expect(spectator.getByTestId('room-claim').getByRole('heading')).toHaveText(
			'What would change your mind?'
		);
		const own = participant.getByRole('button', { name: 'Your position', exact: true });
		const memberId = await own.getAttribute('data-pellet-id');
		const adminView = page.locator(`[data-pellet-id="${memberId}"]`);
		const spectatorView = spectator.locator(`[data-pellet-id="${memberId}"]`);
		const initialX = Number(await own.getAttribute('data-x'));
		await expect(own).toHaveAttribute('data-cell-id', 'notReplied');
		await expect(participant.getByTestId('spectrum-highlight')).toHaveAttribute(
			'data-cell-id',
			'notReplied'
		);
		await own.press('ArrowLeft');
		await expect(adminView).toHaveAttribute('data-x', String(initialX - 10));
		await expect(spectatorView).toHaveAttribute('data-x', String(initialX - 10));
		const box = await own.boundingBox();
		if (!box) throw new Error('Missing own pellet');
		const currentX = Number(await own.getAttribute('data-x'));
		const currentY = Number(await own.getAttribute('data-y'));
		const scale = box.width / 28;
		await participant.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await participant.mouse.down();
		await participant.mouse.move(
			box.x + box.width / 2 + (490 - currentX) * scale,
			box.y + box.height / 2 + (100 - currentY) * scale,
			{
				steps: 8
			}
		);
		// Remote clients must see the movement BEFORE pointer release.
		await expect
			.poll(async () => Math.abs(Number(await adminView.getAttribute('data-y')) - 100))
			.toBeLessThan(3);
		await expect
			.poll(async () => Math.abs(Number(await spectatorView.getAttribute('data-y')) - 100))
			.toBeLessThan(3);
		await expect(own).toHaveAttribute('data-cell-id', 'neutral');
		await expect(participant.getByTestId('spectrum-highlight')).toHaveAttribute(
			'data-cell-id',
			'neutral'
		);
		await expect(spectatorView).toHaveAttribute('data-cell-id', 'neutral');
		await expect(spectator.getByTestId('spectrum-highlight')).toHaveCount(0);
		await participant.mouse.up();
		await expect
			.poll(async () => adminView.getAttribute('data-x'))
			.toBe(await own.getAttribute('data-x'));
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel("Hide everyone's positions", { exact: true }).check();
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(0);
		await expect(participant.locator('[data-pellet-id]')).toHaveCount(1);
		await expect(page.locator('[data-pellet-id]')).toHaveCount(2);
		await page.getByLabel('Show positions to spectators', { exact: true }).uncheck();
		await page.getByLabel("Hide everyone's positions", { exact: true }).uncheck();
		await expect(participant.locator('[data-pellet-id]')).toHaveCount(2);
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(0);
		await page.getByLabel('Show positions to spectators', { exact: true }).check();
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(2);
		await page.getByRole('button', { name: 'Reset positions', exact: true }).click();
		await expect(adminView).toHaveAttribute('data-x', String(initialX));
		await expect(spectatorView).toHaveAttribute('data-x', String(initialX));
		await expect(participant.getByTestId('spectrum-highlight')).toHaveAttribute(
			'data-cell-id',
			'notReplied'
		);
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByTitle('People', { exact: true }).click();
		await page
			.getByRole('button', { name: /^Demote / })
			.first()
			.click();
		await expect(participant.getByTestId('own-role')).toHaveText('spectator');
		await expect(
			participant.getByRole('button', { name: 'Your position', exact: true })
		).toHaveCount(0);
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(1);
		await expect(page.getByRole('alert')).toHaveCount(0);
	} finally {
		await participantContext.close();
		await spectatorContext.close();
	}
});

test('chat channels confine stage and admin messages, and admin removal masks text', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const guestContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await guestContext.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await openChat(guest);
		await openChat(page);
		// A spectator has no channel choice at all.
		await expect(page.getByTestId('chat-channel-stage')).toBeVisible();
		await expect(page.getByTestId('chat-channel-admin')).toBeVisible();
		await expect(guest.getByTestId('chat-channel-stage')).toHaveCount(0);
		await page.getByTestId('chat-channel-stage').click();
		await expect(page.getByTestId('chat-channel-hint')).toHaveText(
			'Only people on stage can read and write here.'
		);
		await page.getByLabel('Chat message', { exact: true }).fill('Stage-only briefing');
		await page.getByRole('button', { name: 'Send message', exact: true }).click();
		// One send cooldown per member applies across channels, so the next
		// channel message has to wait for it rather than bypass it.
		await page.waitForTimeout(600);
		await page.getByTestId('chat-channel-admin').click();
		await page.getByLabel('Chat message', { exact: true }).fill('Admin moderation note');
		await page.getByRole('button', { name: 'Send message', exact: true }).click();
		// The audience filter happens server-side: the spectator never receives
		// the text at all, not even in a hidden element.
		await expect(guest.locator('body')).not.toContainText('Stage-only briefing');
		await expect(guest.locator('body')).not.toContainText('Admin moderation note');
		// The admin sees each channel separately.
		await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Admin moderation note'
		);
		await expect(page.getByRole('log', { name: 'Chat messages' })).not.toContainText(
			'Stage-only briefing'
		);
		await page.getByTestId('chat-channel-room').click();
		await expect(page.getByRole('log', { name: 'Chat messages' })).not.toContainText(
			'Admin moderation note'
		);
		await page.getByTestId('discussion-close').click();
		// Promotion grants stage membership, still without the admin channel.
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: /^Promote / }).click();
		await expect(guest.getByTestId('own-role')).toHaveText('participant');
		await openChat(guest);
		await expect(guest.getByTestId('chat-channel-stage')).toBeVisible();
		await expect(guest.getByTestId('chat-channel-admin')).toHaveCount(0);
		await guest.getByTestId('chat-channel-stage').click();
		await expect(guest.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Stage-only briefing'
		);
		await guest.getByLabel('Chat message', { exact: true }).fill('Harassment from the stage');
		await guest.getByRole('button', { name: 'Send message', exact: true }).click();
		await openPeople(page);
		await page.getByTitle('People', { exact: true }).click();
		await page.getByTestId('discussion-toggle').click();
		await page.getByTestId('chat-channel-stage').click();
		await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Harassment from the stage'
		);
		const entry = page.locator('[data-chat-id]').filter({ hasText: 'Harassment from the stage' });
		await entry.getByLabel('Remove this message').click();
		await page.getByTestId('chat-remove-confirm').click();
		await expect(page.locator('[data-chat-removed]')).toBeVisible();
		await expect(page.getByRole('log', { name: 'Chat messages' })).not.toContainText(
			'Harassment from the stage'
		);
		await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Message removed by an admin'
		);
		await expect(guest.getByRole('log', { name: 'Chat messages' })).not.toContainText(
			'Harassment from the stage'
		);
		await expect(guest.getByText('Message removed by an admin')).toBeVisible();
		// Reloading the author must still show the masked entry, never the text.
		await guest.reload();
		await openChat(guest);
		await guest.getByTestId('chat-channel-stage').click();
		await expect(guest.getByRole('log', { name: 'Chat messages' })).not.toContainText(
			'Harassment from the stage'
		);
		await expect(guest.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Message removed by an admin'
		);
		// Other channels stay intact, and the shared room channel is unaffected.
		await guest.getByTestId('chat-channel-room').click();
		await expect(guest.getByTestId('chat-channel-admin')).toHaveCount(0);
	} finally {
		await guestContext.close();
	}
});

test('chat stays ephemeral, read-only for spectators until allowed, and safe as plain text', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const guestContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const guest = await guestContext.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await expect(await openChat(guest)).toBeDisabled();
		await openChat(page);
		const plain = '<img src=x onerror=alert(1)> Hello from admin';
		await page.getByLabel('Chat message', { exact: true }).fill(plain);
		await page.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(page.getByLabel('Chat message', { exact: true })).toHaveValue('');
		await expect(guest.getByRole('log', { name: 'Chat messages' })).toContainText(plain);
		await expect(guest.getByRole('log', { name: 'Chat messages' }).locator('img')).toHaveCount(0);
		await page.getByTestId('discussion-close').click();
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Allow spectator chat', { exact: true }).check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeEnabled();
		await guest.getByLabel('Chat message', { exact: true }).fill('Hello from spectator');
		await guest.getByLabel('Chat message', { exact: true }).press('Enter');
		await expect(guest.getByLabel('Chat message', { exact: true })).toHaveValue('');
		await expect(page.getByLabel('1 unread updates', { exact: true })).toBeVisible();
		await openChat(page);
		await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Hello from spectator'
		);
		await expect(page.getByLabel('1 unread updates', { exact: true })).toHaveCount(0);
		await page.getByTestId('discussion-close').click();
		await guest.getByLabel('Chat message', { exact: true }).fill('Keep my draft');
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Allow spectator chat', { exact: true }).uncheck();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeDisabled();
		await expect(guest.getByLabel('Chat message', { exact: true })).toHaveValue('Keep my draft');
		await guest.reload();
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await openChat(guest);
		await expect(guest.locator('[data-chat-id]')).toHaveCount(2);
		await expect(guest.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Hello from spectator'
		);
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeDisabled();
		await expect(guest.getByRole('alert')).toHaveCount(0);
	} finally {
		await guestContext.close();
	}
});

test('transcript replaces partials, ignores stale text and isolates rooms', async ({ page }) => {
	let deliver: ((message: string) => void) | undefined;
	let toServer: ((message: string) => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		deliver = (message) => socket.send(message);
		toServer = (message) => server.send(message);
		socket.onMessage((raw) => server.send(raw));
		server.onMessage((raw) => socket.send(raw));
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const roomId = new URL(page.url()).searchParams.get('room');
	// The tab follows the room's own setting, whatever the deployment default is.
	await openDiscussion(page);
	toServer!(
		JSON.stringify({ v: 2, op: 'room.settings', payload: { transcriptionEnabled: false } })
	);
	await expect(page.getByTestId('discussion-tab-transcript')).toHaveCount(0);
	toServer!(JSON.stringify({ v: 2, op: 'room.settings', payload: { transcriptionEnabled: true } }));
	await expect(page.getByTestId('discussion-tab-transcript')).toBeVisible();
	const log = await openTranscript(page);
	const segment = {
		roomId,
		id: 'utterance',
		sequence: 1,
		speakerId: 'm_speaker',
		speakerName: 'Speaker',
		text: 'Bon',
		start: 0,
		end: 500,
		language: 'fr',
		final: false
	};
	if (!deliver) throw new Error('Missing socket');
	deliver(JSON.stringify({ v: 2, op: 'transcript.segment', payload: segment }));
	await expect(log).toContainText('Bon');
	await expect(log).toContainText('In progress');
	deliver(
		JSON.stringify({
			v: 2,
			op: 'transcript.segment',
			payload: { ...segment, sequence: 2, text: 'Bonjour <script>not HTML</script>', final: true }
		})
	);
	await expect(log).toContainText('Bonjour <script>not HTML</script>');
	await expect(log).not.toContainText('In progress');
	deliver(
		JSON.stringify({
			v: 2,
			op: 'transcript.snapshot',
			payload: { roomId, sequence: 1, segments: [segment] }
		})
	);
	deliver(
		JSON.stringify({
			v: 2,
			op: 'transcript.segment',
			payload: {
				...segment,
				id: 'other',
				roomId: 'other-room',
				sequence: 3,
				text: 'Private other room'
			}
		})
	);
	await expect(log.locator('[data-transcript-id]')).toHaveCount(1);
	await expect(log).not.toContainText('Private other room');
	await expect(log.locator('script')).toHaveCount(0);
	const rejected = {
		...segment,
		id: 'noise',
		sequence: 3,
		text: "Sous-titres réalisés par la communauté d'Amara.org"
	};
	deliver(JSON.stringify({ v: 2, op: 'transcript.segment', payload: rejected }));
	await expect(log).toContainText('Amara.org');
	deliver(
		JSON.stringify({
			v: 2,
			op: 'transcript.segment',
			payload: { ...rejected, sequence: 4, text: '', final: true, discarded: true }
		})
	);
	deliver(
		JSON.stringify({
			v: 2,
			op: 'transcript.snapshot',
			payload: { roomId, sequence: 3, segments: [rejected] }
		})
	);
	await expect(log).not.toContainText('Amara.org');
	await expect(log.locator('[data-transcript-id]')).toHaveCount(1);
});

test('chat preserves rejected drafts and new typing while an acknowledgment is delayed', async ({
	page
}) => {
	let reject = true;
	let held: string | null = null;
	let deliver: ((message: string) => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		deliver = (message) => socket.send(message);
		socket.onMessage((raw) => {
			const packet = JSON.parse(String(raw));
			if (packet.op === 'chat.send' && reject) {
				socket.send(
					JSON.stringify({
						v: 2,
						op: 'error',
						payload: {
							code: 'chat_rejected',
							requestId: packet.payload.clientId,
							message: 'Injected cooldown'
						}
					})
				);
			} else server.send(raw);
		});
		server.onMessage((raw) => {
			if (String(raw).includes('"op":"chat.message"')) held = String(raw);
			else socket.send(raw);
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await openChat(page);
	const input = page.getByLabel('Chat message', { exact: true });
	const send = page.getByRole('button', { name: 'Send message', exact: true });
	await input.fill('Rejected draft');
	await send.click();
	await expect(page.getByRole('alert')).toHaveText('Injected cooldown');
	await expect(input).toHaveValue('Rejected draft');
	await expect(send).toBeEnabled();
	reject = false;
	await send.click();
	await expect.poll(() => held !== null).toBe(true);
	await input.fill('New typing while waiting');
	await expect(send).toBeDisabled();
	if (!held || !deliver) throw new Error('Missing delayed chat acknowledgment');
	deliver(held);
	await expect(input).toHaveValue('New typing while waiting');
	await expect(send).toBeEnabled();
	await expect(page.locator('[data-chat-id]')).toHaveCount(1);
	await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText('Rejected draft');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('notes resize across clients without losing drafts, and pin locks layout', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const spectator = await context.newPage();
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Show revealed notes to spectators').check();
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByRole('button', { name: 'New note', exact: true }).click();
		const note = page.locator('[data-note-id]').first();
		const remote = spectator.locator('[data-note-id]').first();
		await note.hover();
		await note.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(remote).toBeVisible();
		await expect(remote.getByRole('button', { name: 'Resize note', exact: true })).toHaveCount(0);
		await note.getByRole('heading', { level: 1 }).fill('Resized draft');
		const handle = note.getByRole('button', { name: 'Resize note', exact: true });
		const box = await handle.boundingBox();
		if (!box) throw new Error('Missing resize handle');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
		await page.mouse.up();
		await expect
			.poll(async () => Number(await remote.getAttribute('data-width')))
			.toBeGreaterThan(360);
		await expect
			.poll(async () => remote.getAttribute('data-height'))
			.toBe(await note.getAttribute('data-height'));
		await expect(note.getByRole('heading', { level: 1 })).toHaveText('Resized draft');
		await expect(note.getByText('Unsaved', { exact: true })).toBeVisible();
		await note.getByRole('button', { name: 'Save note', exact: true }).click();
		await expect(note.locator('.unsaved')).toHaveCount(0);
		await expect(remote).toHaveCount(0);
		await note.getByRole('button', { name: 'Approve', exact: true }).click();
		await note.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(remote.getByRole('heading', { level: 1 })).toHaveText('Resized draft');
		const before = Number(await note.getAttribute('data-width'));
		const resizedHeight = Number(await remote.getAttribute('data-height'));
		await handle.press('ArrowLeft');
		await expect(remote).toHaveAttribute('data-width', String(before - 10));
		for (let index = 0; index < 3; index++) {
			const current = Number(await remote.getAttribute('data-width'));
			await handle.press('Shift+ArrowLeft');
			await expect(remote).toHaveAttribute('data-width', String(current - 40));
		}
		for (let index = 0; index < 2; index++) {
			const current = Number(await remote.getAttribute('data-height'));
			await handle.press('Shift+ArrowUp');
			await expect(remote).toHaveAttribute('data-height', String(current - 40));
		}
		expect(Number(await remote.getAttribute('data-width'))).toBeLessThan(360);
		// Pointer growth is zoom-dependent; keyboard shrink is exactly 80 world units.
		expect(Number(await remote.getAttribute('data-height'))).toBe(resizedHeight - 80);
		await note.getByRole('button', { name: 'Pin note', exact: true }).click();
		await expect(handle).toHaveCount(0);
		const width = await remote.getAttribute('data-width');
		await page.reload();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await expect(note).toHaveAttribute('data-width', width!);
		await expect(note).toHaveAttribute('data-pinned', 'true');
	} finally {
		await context.close();
	}
});

test('spectrum configuration is selectable at creation and synchronized without resetting positions', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('spectrum-slice-count').selectOption('3');
	await page.getByTestId('spectrum-neutral-circle').uncheck();
	await page.getByTestId('initial-topic').fill('Initial topic from v1 setup');
	await page.getByTestId('create-room').click();
	const board = page.getByTestId('spectrum-board');
	await expect(board).toHaveAttribute('data-slice-count', '3');
	await expect(board).toHaveAttribute('data-neutral-circle', 'false');
	await expect(page.getByTestId('room-claim')).toContainText('Initial topic from v1 setup');
	const context = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const spectator = await context.newPage();
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		const remote = spectator.getByTestId('spectrum-board');
		await expect(remote).toHaveAttribute('data-slice-count', '3');
		await expect(remote).toHaveAttribute('data-neutral-circle', 'false');
		await expect(spectator.getByTestId('spectrum-slice-count')).toHaveCount(0);
		const own = page.getByRole('button', { name: 'Your position', exact: true });
		await own.press('ArrowLeft');
		const position = await own.getAttribute('data-x');
		await page.getByLabel('Room options', { exact: true }).click();
		for (const count of [5, 7, 9, 3]) {
			await page.getByTestId('spectrum-slice-count').selectOption(String(count));
			await expect(remote).toHaveAttribute('data-slice-count', String(count));
			await expect(board).toHaveAttribute('data-slice-count', String(count));
			await expect(own).toHaveAttribute('data-x', position!);
		}
		await expect(own).toHaveAttribute('data-cell-id', '');
		await page.getByTestId('spectrum-neutral-circle').check();
		await expect(remote).toHaveAttribute('data-neutral-circle', 'true');
		await expect(own).toHaveAttribute('data-cell-id', 'notReplied');
		await page.getByLabel('Room options', { exact: true }).click();
		await page.reload();
		await expect(board).toHaveAttribute('data-slice-count', '3');
		await expect(board).toHaveAttribute('data-neutral-circle', 'true');
		await expect(page.getByRole('alert')).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test('neutral-circle masking hides pixels and hit targets in every FR/EN layout', async ({
	page
}) => {
	await page.goto('/v2');
	const results = await page.evaluate(async () => {
		const modulePath = '/src/lib/canvas/cells.ts';
		const geometry = (await import(modulePath)) as typeof import('../src/lib/canvas/cells');
		const canvas = document.createElement('canvas');
		canvas.width = 980;
		canvas.height = 735;
		const context = canvas.getContext('2d')!;
		const results = [];
		for (const language of ['', '_en']) {
			for (const slices of [3, 5, 7, 9]) {
				const source = `/spectrum${language}${slices === 7 ? '' : `_${slices}`}.svg`;
				for (const visible of [true, false]) {
					const graphic = await geometry.loadSpectrumGraphic(source, visible);
					const image = new Image();
					await new Promise<void>((resolve, reject) => {
						image.onload = () => resolve();
						image.onerror = reject;
						image.src = graphic.imageSource;
					});
					context.clearRect(0, 0, 980, 735);
					context.drawImage(image, 0, 0, 980, 735);
					const detect = geometry.createCellDetector(graphic.cells);
					results.push({
						source,
						visible,
						count: graphic.cells.length,
						slices,
						indifferent: detect(490, 430)?.id ?? null,
						waiting: detect(490, 580)?.id ?? null,
						neutral: detect(490, 100)?.id,
						indifferentAlpha: context.getImageData(490, 430, 1, 1).data[3],
						waitingAlpha: context.getImageData(490, 580, 1, 1).data[3],
						neutralAlpha: context.getImageData(490, 100, 1, 1).data[3]
					});
				}
			}
		}
		return results;
	});
	for (const result of results) {
		expect(result, result.source).toMatchObject({
			count: result.slices + (result.visible ? 2 : 0),
			indifferent: result.visible ? 'indifferent' : null,
			waiting: result.visible ? 'notReplied' : null,
			neutral: 'neutral',
			indifferentAlpha: result.visible ? 255 : 0,
			waitingAlpha: result.visible ? 255 : 0,
			neutralAlpha: 255
		});
	}
});

test('activity journal records claims, membership and settled opinions without reconnect duplicates', async ({
	page,
	browser
}) => {
	let disconnect: (() => void) | undefined;
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((raw) => server.send(raw));
		server.onMessage((raw) => socket.send(raw));
		disconnect = () => {
			socket.close();
			server.close();
		};
	});
	await page.goto('/v2');
	await page.getByTestId('initial-topic').fill('First claim <script>not HTML</script>');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const log = await openActivity(page);
	await expect(log.locator('[data-event-kind="join"]')).toHaveCount(1);
	await expect(log.locator('[data-event-kind="topic"]')).toContainText(
		'First claim <script>not HTML</script>'
	);
	await expect(log.locator('script')).toHaveCount(0);
	const context = await newRoomContext(browser, { storageState: englishLocale });
	let leave: (() => void) | undefined;
	try {
		const actor = await context.newPage();
		await actor.routeWebSocket('**/spectrum/ws', (socket) => {
			const server = socket.connectToServer();
			socket.onMessage((raw) => server.send(raw));
			server.onMessage((raw) => socket.send(raw));
			leave = () => server.send(JSON.stringify({ procedure: 'leavespectrum', arguments: [] }));
		});
		await actor.goto(page.url());
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await expect(log.locator('[data-event-kind="join"]')).toHaveCount(2);
		await actor.getByTitle('People', { exact: true }).click();
		await actor.getByLabel('Your pseudonym').fill('Journal speaker');
		await actor.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
		await actor.getByTitle('People', { exact: true }).click();
		await expect(log.locator('[data-event-kind="nickname"]')).toContainText('Journal speaker');
		await page.getByTitle('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Promote Journal speaker', exact: true }).click();
		await page.getByTitle('People', { exact: true }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await openActivity(page);
		await expect(log.locator('[data-event-kind="role"]')).toContainText('Journal speaker');
		await expect(log.locator('[data-event-kind="join"]')).toHaveCount(2);
		await moveActivityPellet(actor, 490, 100);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(1);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveAttribute(
			'data-event-cell',
			'neutral'
		);
		await page.getByTestId('edit-claim').click();
		await page.getByTestId('claim-input').fill('Second claim');
		await page.getByTestId('save-claim').click();
		await openActivity(page);
		await expect(log.locator('[data-event-kind="topic"]')).toHaveCount(2);
		await actor.getByRole('button', { name: 'Your position', exact: true }).press('ArrowRight');
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(2);
		if (!disconnect) throw new Error('Missing socket');
		disconnect();
		await expect(log.locator('[data-event-kind="reconnected"]')).toHaveCount(1, { timeout: 15000 });
		await expect(log.locator('[data-event-kind="join"]')).toHaveCount(2);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(2);
		if (!leave) throw new Error('Missing actor socket');
		leave();
		await expect(log.locator('[data-event-kind="leave"]')).toContainText('Journal speaker');
		await page.reload();
		await expect(page.getByTestId('own-role')).toHaveText('admin');
		await openActivity(page);
		await expect(log.locator('[data-event-kind="join"]')).toHaveCount(1);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(0);
		await page.setViewportSize({ width: 390, height: 844 });
		const panel = await page.locator('#room-activity').boundingBox();
		if (!panel) throw new Error('Missing mobile activity panel');
		expect(panel.x).toBeGreaterThanOrEqual(0);
		expect(panel.x + panel.width).toBeLessThanOrEqual(390);
		expect(panel.y).toBeGreaterThanOrEqual(0);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('discussion-toggle')).toHaveAttribute('aria-expanded', 'false');
	} finally {
		await context.close();
	}
});

test('activity journal never exposes hidden or retrospective private opinions to spectators', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const actorContext = await newRoomContext(browser, { storageState: englishLocale }),
		observerContext = await newRoomContext(browser, { storageState: englishLocale });
	try {
		const actor = await actorContext.newPage(),
			observer = await observerContext.newPage();
		await actor.goto(page.url());
		await expect(actor.getByTestId('own-role')).toHaveText('spectator');
		await page.getByTitle('People', { exact: true }).click();
		await page
			.getByRole('button', { name: /^Promote / })
			.first()
			.click();
		await page.getByTitle('People', { exact: true }).click();
		await expect(actor.getByTestId('own-role')).toHaveText('participant');
		await observer.goto(page.url());
		await expect(observer.getByTestId('own-role')).toHaveText('spectator');
		const log = await openActivity(observer);
		await moveActivityPellet(actor, 490, 100);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(1);
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel("Hide everyone's positions", { exact: true }).check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(0);
		const adminLog = await openActivity(page);
		await moveActivityPellet(actor, 100, 400);
		await expect(adminLog.locator('[data-event-kind="opinion"]')).toHaveCount(2);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(0);
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel("Hide everyone's positions", { exact: true }).uncheck();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(observer.locator('[data-pellet-id]')).toHaveCount(2);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(0);
		await moveActivityPellet(actor, 490, 100);
		await expect(log.locator('[data-event-kind="opinion"]')).toHaveCount(1);
	} finally {
		await actorContext.close();
		await observerContext.close();
	}
});

test('cell detection matches the exact FR/EN SVG geometry for all layouts', async ({ page }) => {
	await page.goto('/v2');
	const results = await page.evaluate(async () => {
		const modulePath = '/src/lib/canvas/cells.ts';
		const geometry = (await import(modulePath)) as typeof import('../src/lib/canvas/cells');
		const results = [];
		for (const language of ['', '_en']) {
			for (const slices of [3, 5, 7, 9]) {
				const source = `/spectrum${language}${slices === 7 ? '' : `_${slices}`}.svg`;
				const cells = await geometry.loadSpectrumCells(source);
				const detect = geometry.createCellDetector(cells);
				results.push({
					source,
					slices,
					count: cells.length,
					neutral: detect(490, 100)?.id,
					indifferent: detect(490, 450)?.id,
					waiting: detect(490, 580)?.id,
					outside: detect(490, 300)
				});
			}
		}
		return results;
	});
	for (const result of results) {
		expect(result, result.source).toMatchObject({
			count: result.slices + 2,
			neutral: 'neutral',
			indifferent: 'indifferent',
			waiting: 'notReplied',
			outside: null
		});
	}
});

test('workspace fills desktop and mobile viewports without root layout margins', async ({
	page
}) => {
	for (const viewport of [
		{ width: 1600, height: 1000 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/v2');
		await expect(page.locator('canvas')).toHaveCount(3);
		const canvas = await page.locator('canvas').first().boundingBox();
		expect(canvas?.x).toBe(0);
		expect(canvas?.width).toBe(viewport.width);
		const documentSize = await page.evaluate(() => ({
			width: document.documentElement.scrollWidth,
			height: document.documentElement.scrollHeight
		}));
		expect(documentSize).toEqual(viewport);
	}
});
