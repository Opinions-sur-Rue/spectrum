import { defineConfig } from '@playwright/test';

export default defineConfig({
	// Live v2 integration tests require the Go backend; run test:e2e:v2.
	testIgnore: [
		'v2.test.ts',
		'voice.test.ts',
		'transcription.test.ts',
		'browser-transcription.test.ts'
	],
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173
	},
	testDir: 'e2e'
});
