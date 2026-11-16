import { test as base, type Browser, type BrowserContext } from '@playwright/test';

/** These legacy v1 stylesheet imports must not make v2 tests depend on CDNs.
 * Keep application assets, API calls and WebSockets untouched. */
export async function isolateExternalStyles(context: BrowserContext) {
	await context.route(
		/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//,
		(route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' })
	);
}

export async function newRoomContext(
	browser: Browser,
	options: Parameters<Browser['newContext']>[0]
) {
	const context = await browser.newContext(options);
	await isolateExternalStyles(context);
	return context;
}

export const test = base.extend({
	context: async ({ context }, use) => {
		await isolateExternalStyles(context);
		await use(context);
	}
});
