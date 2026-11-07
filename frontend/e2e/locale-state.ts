import type { BrowserContextOptions } from '@playwright/test';

/**
 * The app defaults to French. End-to-end assertions use the English catalog,
 * so every browser context starts with the locale cookie already set.
 */
export const englishLocale: BrowserContextOptions['storageState'] = {
	cookies: [
		{
			name: 'PARAGLIDE_LOCALE',
			value: 'en',
			domain: 'localhost',
			path: '/',
			expires: -1,
			httpOnly: false,
			secure: false,
			sameSite: 'Lax'
		}
	],
	origins: []
};
