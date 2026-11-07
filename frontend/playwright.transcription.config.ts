import { defineConfig } from '@playwright/test';
import base from './playwright.voice.config';

export default defineConfig({
	...base,
	testMatch: 'transcription.test.ts',
	projects: base.projects?.filter((project) => project.name === 'chromium')
});
