import { chromium, expect, firefox, test } from '@playwright/test';

test('inline Markdown notes and actions synchronize across Firefox and Chrome', async ({
	page,
	browserName
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/v2');
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.locator('header')).toContainText('admin');
	await expect(page).toHaveURL(/room=/);
	const spectatorBrowser = await (browserName === 'firefox' ? chromium : firefox).launch();
	const spectator = await spectatorBrowser.newPage();
	spectator.on('pageerror', (error) => errors.push(error.message));
	try {
		await spectator.goto(page.url());
		await expect(spectator.locator('header')).toContainText('spectator');
		await expect(spectator.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'New note', exact: true }).click();
		const cards = page.locator('[data-note-id]');
		const spectatorCards = spectator.locator('[data-note-id]');
		await expect(cards).toHaveCount(1);
		await expect(spectatorCards).toHaveCount(0);
		const first = cards.first();
		await expect(first.getByRole('heading', { level: 1 })).toHaveText('New note');
		await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0);
		await expect(page.locator('aside, [role="dialog"]')).toHaveCount(0);
		await page.mouse.move(5, 200);
		await expect(first.getByRole('button', { name: 'Reveal', exact: true })).toBeHidden();
		await first.hover();
		await expect(first.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
		await expect(first.getByRole('button', { name: 'H1', exact: true })).toBeHidden();
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
		await second.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectatorCards).toHaveCount(2);
		await second.getByLabel('Target note').selectOption({ label: 'First argument' });
		await second.getByRole('button', { name: 'Create link', exact: true }).click();
		await expect(spectator.getByRole('status')).toContainText('Links (1)');
		// An unfocused note drags from its text without a handle or editor focus.
		await page.getByText('Spectrum v2', { exact: true }).click();
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
			.poll(async () => spectatorCards.last().getAttribute('style'))
			.toBe(await second.getAttribute('style'));
		await expect(second.getByRole('button', { name: 'H1', exact: true })).toBeHidden();
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
		await page.getByText('Spectrum v2', { exact: true }).click();
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
		await expect(spectator.getByRole('status')).toContainText('Links (0)');
		await second.getByRole('button', { name: 'Reveal', exact: true }).click();
		await expect(spectatorCards).toHaveCount(2);
		await expect(spectator.getByRole('status')).toContainText('Links (1)');
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
		await expect(cards).toHaveCount(1);
		await expect(page.getByRole('status')).toContainText('Links (0)');
		await page.reload();
		await expect(page.locator('header')).toContainText('admin');
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
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const authorContext = await browser.newContext();
	const observerContext = await browser.newContext();
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
		await author.getByLabel('People', { exact: true }).click();
		await author.getByLabel('Your pseudonym').fill('Alice');
		await author.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
		await author.getByLabel('People', { exact: true }).click();
		await page.getByLabel('People', { exact: true }).click();
		await expect(page.getByRole('heading', { name: 'On stage (1/6)', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Promote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('participant');
		await page.getByLabel('People', { exact: true }).click();
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
		await page.getByLabel('People', { exact: true }).click();
		await page.getByRole('button', { name: 'Demote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('spectator');
		await expect(author.locator('[data-note-id]')).toHaveCount(0);
		await expect(author.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'Promote Alice', exact: true }).click();
		await expect(author.getByTestId('own-role')).toHaveText('participant');
		await expect(draft.getByRole('heading', { level: 1 })).toHaveText('Proposal from Alice');
		await page.getByLabel('People', { exact: true }).click();
		await page.getByLabel('Pending notes (1)', { exact: true }).click();
		await page.getByRole('button', { name: 'Approve Proposal from Alice', exact: true }).click();
		await expect(page.getByLabel('Pending notes (1)', { exact: true })).toHaveCount(0);
		await expect(draft.getByRole('textbox', { name: 'Note content' })).toHaveAttribute(
			'contenteditable',
			'false'
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
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const participantContext = await browser.newContext();
	const spectatorContext = await browser.newContext();
	try {
		const participant = await participantContext.newPage();
		const spectator = await spectatorContext.newPage();
		await participant.goto(page.url());
		await expect(participant.getByTestId('own-role')).toHaveText('spectator');
		await page.getByLabel('People', { exact: true }).click();
		await page
			.getByRole('button', { name: /^Promote / })
			.first()
			.click();
		await page.getByLabel('People', { exact: true }).click();
		await expect(participant.getByTestId('own-role')).toHaveText('participant');
		await spectator.goto(page.url());
		await expect(spectator.getByTestId('own-role')).toHaveText('spectator');
		await expect(spectator.locator('[data-pellet-id]')).toHaveCount(2);
		await page.getByLabel('Discussion topic').fill('What would change your mind?');
		await page.getByRole('button', { name: 'Save topic', exact: true }).click();
		await expect(spectator.getByTestId('spectrum-board').getByRole('heading')).toHaveText(
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
		await page.getByLabel('People', { exact: true }).click();
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

test('chat stays ephemeral, read-only for spectators until allowed, and safe as plain text', async ({
	page,
	browser
}) => {
	await page.goto('/v2');
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const guestContext = await browser.newContext();
	try {
		const guest = await guestContext.newPage();
		await guest.goto(page.url());
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByRole('button', { name: 'Chat', exact: true }).click();
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeDisabled();
		await page.getByRole('button', { name: 'Chat', exact: true }).click();
		const plain = '<img src=x onerror=alert(1)> Hello from admin';
		await page.getByLabel('Chat message', { exact: true }).fill(plain);
		await page.getByRole('button', { name: 'Send message', exact: true }).click();
		await expect(page.getByLabel('Chat message', { exact: true })).toHaveValue('');
		await expect(guest.getByRole('log', { name: 'Chat messages' })).toContainText(plain);
		await expect(guest.getByRole('log', { name: 'Chat messages' }).locator('img')).toHaveCount(0);
		await page.getByRole('button', { name: 'Close chat', exact: true }).click();
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Allow spectator chat', { exact: true }).check();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeEnabled();
		await guest.getByLabel('Chat message', { exact: true }).fill('Hello from spectator');
		await guest.getByLabel('Chat message', { exact: true }).press('Enter');
		await expect(guest.getByLabel('Chat message', { exact: true })).toHaveValue('');
		await expect(page.getByLabel('1 unread messages', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Chat', exact: true }).click();
		await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
			'Hello from spectator'
		);
		await expect(page.getByLabel('1 unread messages', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Close chat', exact: true }).click();
		await guest.getByLabel('Chat message', { exact: true }).fill('Keep my draft');
		await page.getByLabel('Room options', { exact: true }).click();
		await page.getByLabel('Allow spectator chat', { exact: true }).uncheck();
		await page.getByLabel('Room options', { exact: true }).click();
		await expect(guest.getByLabel('Chat message', { exact: true })).toBeDisabled();
		await expect(guest.getByLabel('Chat message', { exact: true })).toHaveValue('Keep my draft');
		await guest.reload();
		await expect(guest.getByTestId('own-role')).toHaveText('spectator');
		await guest.getByRole('button', { name: 'Chat', exact: true }).click();
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
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	await page.getByRole('button', { name: 'Chat', exact: true }).click();
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
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
	const context = await browser.newContext();
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
		await expect(remote.getByRole('heading', { level: 1 })).toHaveText('Resized draft');
		const before = Number(await note.getAttribute('data-width'));
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
		expect(Number(await remote.getAttribute('data-height'))).toBeLessThan(340);
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
