import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './network-assets';

declare global {
	interface Window {
		__mobileViewport: EventTarget & {
			width: number;
			height: number;
			offsetLeft: number;
			offsetTop: number;
		};
	}
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
	await page.addInitScript(() => {
		window.__mobileViewport = Object.assign(new EventTarget(), {
			width: window.innerWidth,
			height: window.innerHeight,
			offsetLeft: 0,
			offsetTop: 0
		});
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			get: () => window.__mobileViewport
		});
	});
	await page.routeWebSocket('**/spectrum/ws', (socket) => {
		const server = socket.connectToServer();
		server.onMessage((data) => {
			const lines = String(data)
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => {
					const event = JSON.parse(line);
					if (event.op === 'room.state') {
						// Exercise the densest toolbar, even with a text-only local backend.
						event.payload.voice = {
							available: true,
							generation: event.payload.voice?.generation ?? 0
						};
						event.payload.transcription = { available: true, ready: false, mode: 'browser' };
						// Opt the room in so the fixture really exercises the densest tab strip.
						event.payload.settings = {
							...event.payload.settings,
							transcriptionEnabled: true
						};
						for (let i = 0; i < 35; i++)
							event.payload.members.push({
								id: `fixture-${i}`,
								nickname: i === 0 ? 'VeryLongPseudonymWithoutAnySpaces'.repeat(3) : `Member ${i}`,
								role: i < 5 ? 'participant' : 'spectator',
								color: '5950e5'
							});
					}
					return JSON.stringify(event);
				});
			socket.send(lines.join('\n'));
		});
	});
	await page.goto('/v2');
	await page.getByTestId('create-room').click();
	await expect(page.getByTestId('own-role')).toHaveText('admin');
}

async function viewport(page: Page, width: number, height: number, x = 0, y = 0) {
	await page.evaluate(
		({ width, height, x, y }) => {
			Object.assign(window.__mobileViewport, { width, height, offsetLeft: x, offsetTop: y });
			window.__mobileViewport.dispatchEvent(new Event('resize'));
			window.__mobileViewport.dispatchEvent(new Event('scroll'));
		},
		{ width, height, x, y }
	);
}

async function inside(page: Page, element: Locator) {
	await expect
		.poll(async () => {
			const bounds = await element.boundingBox();
			const visible = await page.evaluate(() => ({
				x: window.__mobileViewport.offsetLeft,
				y: window.__mobileViewport.offsetTop,
				width: window.__mobileViewport.width,
				height: window.__mobileViewport.height
			}));
			return (
				!!bounds &&
				bounds.x >= visible.x - 1 &&
				bounds.y >= visible.y - 1 &&
				bounds.x + bounds.width <= visible.x + visible.width + 1 &&
				bounds.y + bounds.height <= visible.y + visible.height + 1
			);
		})
		.toBe(true);
}

test('people sheet keeps profile and close visible while only the list scrolls', async ({
	page
}) => {
	await setup(page);
	await page.getByTestId('edit-pseudonym').click();
	const panel = page.getByTestId('people-panel');
	const input = page.getByLabel('Your pseudonym', { exact: true });
	await expect(input).toBeFocused();
	await expect(panel).toHaveAttribute('aria-modal', 'true');
	await inside(page, panel);
	await inside(page, input);
	// Positioned toolbar controls must not paint or intercept taps above the sheet.
	await expect
		.poll(() =>
			panel.evaluate((node) => {
				const rect = node.getBoundingClientRect();
				return [0.05, 0.15, 0.5, 0.85, 0.95].every((x) =>
					[0.03, 0.08, 0.5, 0.96].every((y) =>
						node.contains(
							document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y)
						)
					)
				);
			})
		)
		.toBe(true);
	await expect(page.locator('[data-member-id]')).toHaveCount(36);
	const memberName = panel.locator('[data-member-name="fixture-0"]');
	const memberActions = panel.locator('[data-member-actions="fixture-0"]');
	await expect(memberName).toBeVisible();
	expect(await memberName.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	const nameBounds = (await memberName.boundingBox())!;
	const actionBounds = (await memberActions.boundingBox())!;
	expect(nameBounds.width).toBeGreaterThanOrEqual(200);
	expect(actionBounds.y).toBeGreaterThanOrEqual(nameBounds.y + nameBounds.height);
	expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await page.screenshot({ path: test.info().outputPath('people-mobile.png') });
	const heading = await panel.locator('header').boundingBox();
	await panel.locator('.people-body').evaluate((node) => {
		node.scrollTop = node.scrollHeight;
	});
	expect(await panel.locator('header').boundingBox()).toEqual(heading);
	await inside(page, input);
	await viewport(page, 320, 320, 12, 80);
	await inside(page, panel);
	await inside(page, input);
	await inside(page, page.getByRole('button', { name: 'Close participants', exact: true }));
	expect(
		await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
	).toBeGreaterThanOrEqual(16);
	await input.fill('Mobile pseudonym');
	await page.getByRole('button', { name: 'Save pseudonym', exact: true }).click();
	await expect(input).toHaveAttribute('placeholder', 'Mobile pseudonym');
	await page.getByRole('button', { name: 'Close participants', exact: true }).click();
	await expect(panel).toBeHidden();
	await viewport(page, 390, 844);
	await expect(page.getByTestId('edit-pseudonym')).toContainText('Mobile pseudonym');
	await expect(page.getByLabel('People', { exact: true })).toBeFocused();
	const documentSize = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight
	}));
	expect(documentSize.width).toBeLessThanOrEqual(390);
	expect(documentSize.height).toBeLessThanOrEqual(844);
});

test('discussion follows keyboard and viewport offsets without losing drafts or focus', async ({
	page
}) => {
	await setup(page);
	await page.getByTestId('discussion-toggle').click();
	const panel = page.getByTestId('discussion-panel');
	const input = page.getByLabel('Chat message', { exact: true });
	await input.fill('Draft kept while the keyboard is visible');
	await page.screenshot({ path: test.info().outputPath('discussion-mobile.png') });
	await viewport(page, 320, 350, 18, 65);
	await inside(page, panel);
	await inside(page, input);
	await inside(page, page.getByTestId('discussion-close'));
	expect(
		await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
	).toBeGreaterThanOrEqual(16);
	await page.getByTestId('discussion-close').click();
	await expect(panel).toBeHidden();
	await viewport(page, 390, 844);
	await expect(page.getByTestId('discussion-toggle')).toBeFocused();
	await page.getByTestId('discussion-toggle').click();
	await expect(input).toHaveValue('Draft kept while the keyboard is visible');
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
	await page.getByTestId('edit-pseudonym').click();
	await expect(page.getByTestId('people-panel')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('people-panel')).toBeHidden();
});

test('help expands in document flow instead of covering canvas controls', async ({ page }) => {
	await setup(page);
	const help = page.getByTestId('room-onboarding');
	await expect(help).toHaveJSProperty('open', false);
	await help.locator('summary').click();
	await expect(help).toHaveJSProperty('open', true);
	const helpBounds = (await help.boundingBox())!;
	const canvas = (await page.getByTestId('canvas-viewport').boundingBox())!;
	expect(helpBounds.y + helpBounds.height).toBeLessThanOrEqual(canvas.y + 1);
	await page.getByRole('button', { name: 'Close help', exact: true }).click();
	await expect(help).toHaveJSProperty('open', false);
});

test('small screens keep document width bounded and v1 regains its own page scrolling', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await setup(page);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	for (const testId of ['edit-pseudonym', 'new-note', 'discussion-toggle'])
		await inside(page, page.getByTestId(testId));
	expect((await page.getByTestId('canvas-viewport').boundingBox())!.height).toBeGreaterThan(80);
	await page.screenshot({ path: test.info().outputPath('small-dense-toolbar.png') });
	await page.getByLabel('People', { exact: true }).click();
	await inside(page, page.getByTestId('people-panel'));
	await inside(page, page.getByRole('button', { name: 'Close participants', exact: true }));
	await page.keyboard.press('Escape');
	await page.getByTestId('app-menu').click();
	await page.getByTestId('back-to-v1').click();
	await expect(page).toHaveURL(new URL('/', page.url()).href);
	await expect(page.getByTestId('own-role')).toHaveCount(0);
	await expect(page.locator('h1')).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.classList.contains('v2-active')))
		.toBe(false);
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
		'scroll'
	);
});
