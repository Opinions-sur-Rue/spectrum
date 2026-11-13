/** Microphone choice is listener-local and optional; nothing leaves the device. */
const KEY = 'spectrum-mic-device';

export interface AudioInputOption {
	id: string;
	label: string;
}

export function audioInputOptions(
	devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]
): AudioInputOption[] {
	const seen = new Set<string>();
	const options: AudioInputOption[] = [];
	for (const device of devices) {
		if (device.kind !== 'audioinput' || !device.deviceId || seen.has(device.deviceId)) continue;
		seen.add(device.deviceId);
		options.push({ id: device.deviceId, label: device.label.trim() });
	}
	return options;
}

export function loadMicDevice(): string | null {
	try {
		return localStorage.getItem(KEY) || null;
	} catch {
		return null;
	}
}

export function saveMicDevice(deviceId: string | null): void {
	try {
		if (deviceId) localStorage.setItem(KEY, deviceId);
		else localStorage.removeItem(KEY);
	} catch {
		/* Storage may be disabled. */
	}
}
