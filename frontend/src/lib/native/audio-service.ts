import { Capacitor, registerPlugin } from '@capacitor/core';

interface SpectrumPluginInterface {
	requestAudioPermission(): Promise<{ granted: boolean }>;
	startAudioService(): Promise<void>;
	stopAudioService(): Promise<void>;
}

const SpectrumPlugin = registerPlugin<SpectrumPluginInterface>('SpectrumPlugin');

/**
 * Request RECORD_AUDIO permission on Android.
 * On web/iOS, falls back to the standard browser getUserMedia permission flow.
 * Returns true if permission is granted.
 */
export async function requestAudioPermission(): Promise<boolean> {
	if (Capacitor.getPlatform() !== 'android') {
		// On web, permission is requested implicitly by getUserMedia — no action needed here
		return true;
	}
	try {
		const { granted } = await SpectrumPlugin.requestAudioPermission();
		return granted;
	} catch (e) {
		console.warn('requestAudioPermission failed:', e);
		return false;
	}
}

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
