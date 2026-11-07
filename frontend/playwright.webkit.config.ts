import { defineConfig } from '@playwright/test';
import base from './playwright.v2.config';

/** WebKit is the closest available Safari engine on Linux; it is not macOS/iOS Safari. */
export default defineConfig({
	...base,
	projects: [{ name: 'webkit', use: { browserName: 'webkit' } }]
});
