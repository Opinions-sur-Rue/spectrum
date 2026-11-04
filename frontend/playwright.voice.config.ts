import { defineConfig } from '@playwright/test';
import base from './playwright.v2.config';

export default defineConfig({
	...base,
	timeout: 120000,
	testMatch: 'voice.test.ts',
	projects: [
		{
			name: 'chromium',
			use: {
				browserName: 'chromium',
				launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
			}
		},
		{
			name: 'firefox',
			use: {
				browserName: 'firefox',
				launchOptions: {
					// Firefox hides host candidates behind mDNS names that LiveKit's ICE
					// agent cannot resolve inside the dev network, so loopback checks fail.
					firefoxUserPrefs: {
						'media.autoplay.default': 0,
						'media.autoplay.block-webaudio': false,
						'media.peerconnection.ice.obfuscate_host_addresses': false
					}
				}
			}
		}
	]
});
