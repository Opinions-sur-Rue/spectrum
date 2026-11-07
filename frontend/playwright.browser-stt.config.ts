import { defineConfig } from '@playwright/test';
import voice from './playwright.voice.config';

export default defineConfig({
	...voice,
	timeout: 180000,
	testDir: 'e2e',
	testMatch: 'browser-transcription.test.ts',
	workers: 1,
	...(process.env.SPECTRUM_TEST_WEBGPU === 'true'
		? {
				projects: [
					{
						name: 'chrome-webgpu',
						use: {
							browserName: 'chromium' as const,
							channel: 'chrome',
							headless: false,
							launchOptions: {
								args: [
									'--enable-features=Vulkan',
									'--use-angle=vulkan',
									'--autoplay-policy=no-user-gesture-required'
								]
							}
						}
					}
				]
			}
		: {})
});
