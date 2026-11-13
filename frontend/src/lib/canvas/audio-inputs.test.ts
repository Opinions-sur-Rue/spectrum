import { afterEach, expect, it, vi } from 'vitest';
import { audioInputOptions, loadMicDevice, saveMicDevice } from './audio-inputs';

afterEach(() => vi.unstubAllGlobals());

it('keeps only distinct audio inputs and preserves labels for permission checks', () => {
	const options = audioInputOptions([
		{ kind: 'audioinput', deviceId: 'a', label: ' USB mic ' },
		{ kind: 'audioinput', deviceId: 'a', label: 'USB mic (duplicate)' },
		{ kind: 'audioinput', deviceId: 'b', label: '' },
		{ kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
		{ kind: 'audiooutput', deviceId: 'out', label: 'Speaker' },
		{ kind: 'audioinput', deviceId: '', label: 'No id' }
	]);
	expect(options).toEqual([
		{ id: 'a', label: 'USB mic' },
		{ id: 'b', label: '' }
	]);
	expect(audioInputOptions([])).toEqual([]);
});

it('remembers a device id and fails quietly without storage', () => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key)
	});
	expect(loadMicDevice()).toBeNull();
	saveMicDevice('mic-2');
	expect(loadMicDevice()).toBe('mic-2');
	saveMicDevice(null);
	expect(loadMicDevice()).toBeNull();

	vi.stubGlobal('localStorage', {
		getItem: () => {
			throw new Error('blocked');
		},
		setItem: () => {
			throw new Error('blocked');
		},
		removeItem: () => {
			throw new Error('blocked');
		}
	});
	expect(loadMicDevice()).toBeNull();
	expect(() => saveMicDevice('mic')).not.toThrow();
});
