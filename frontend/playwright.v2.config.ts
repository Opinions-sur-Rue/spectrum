import { defineConfig } from '@playwright/test';

export default defineConfig({
	timeout: 60000,
	testDir: 'e2e',
	testMatch: 'v2.test.ts',
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'firefox', use: { browserName: 'firefox' } }
	],
	use: { baseURL: 'http://localhost:5173' },
	webServer: {
		command: 'npm run dev -- --host 0.0.0.0',
		port: 5173,
		reuseExistingServer: true
	}
});
