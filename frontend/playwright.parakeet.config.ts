import { defineConfig } from '@playwright/test';

// Inference only: no backend, SFU, microphone or production clients required.
export default defineConfig({
	testDir: 'e2e',
	testMatch: 'parakeet.test.ts',
	timeout: 180000,
	workers: 1,
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'firefox', use: { browserName: 'firefox' } },
		{ name: 'webkit', use: { browserName: 'webkit' } }
	],
	use: { baseURL: 'http://127.0.0.1:5198' },
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 5198 --strictPort',
		url: 'http://127.0.0.1:5198',
		reuseExistingServer: false
	}
});
