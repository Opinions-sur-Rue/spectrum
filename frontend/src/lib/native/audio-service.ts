import { Capacitor, registerPlugin } from '@capacitor/core';

interface SpectrumPluginInterface {
	startAudioService(): Promise<void>;
	stopAudioService(): Promise<void>;
}

const SpectrumPlugin = registerPlugin<SpectrumPluginInterface>('SpectrumPlugin');

/**
 * Start the Android foreground service that keeps audio alive in background.
 * No-op on web/iOS.
 */
export async function startAudioForegroundService(): Promise<void> {
	if (Capacitor.getPlatform() !== 'android') return;
	try {
		await SpectrumPlugin.startAudioService();
	} catch (e) {
		console.warn('startAudioService failed:', e);
	}
}

/**
 * Stop the Android foreground service when leaving the room or closing the app.
 * No-op on web/iOS.
 */
export async function stopAudioForegroundService(): Promise<void> {
	if (Capacitor.getPlatform() !== 'android') return;
	try {
		await SpectrumPlugin.stopAudioService();
	} catch (e) {
		console.warn('stopAudioService failed:', e);
	}
}
