import { expect, it } from 'vitest';
import { mobileBrowser } from './in-app-browser';

it('recognizes Android WebView and explicit app markers', () => {
	expect(
		mobileBrowser('Mozilla/5.0 (Linux; Android 14; Pixel; wv) Chrome/130 Mobile Safari/537.36')
	).toEqual({ platform: 'android', embedded: true });
	expect(mobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Discord/250')).toEqual({
		platform: 'ios',
		embedded: true
	});
});

it('does not claim normal mobile browsers are embedded', () => {
	expect(mobileBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toEqual({
		platform: 'android',
		embedded: false
	});
	expect(
		mobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1')
	).toEqual({ platform: 'ios', embedded: false });
	expect(mobileBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36')).toBeNull();
});
