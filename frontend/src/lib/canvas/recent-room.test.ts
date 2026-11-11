import { afterEach, expect, it, vi } from 'vitest';
import { clearRecentRoom, loadRecentRoom, parseRecentRoom, saveRecentRoom } from './recent-room';

afterEach(() => vi.unstubAllGlobals());

it('accepts only room codes and remembers the last valid one', () => {
	expect(parseRecentRoom(' osr-abcd1234 ')).toBe('OSR-ABCD1234');
	expect(parseRecentRoom('https://spectrum.utile.space/v2?room=OSR-ABCD')).toBeNull();
	expect(parseRecentRoom('OSR-')).toBeNull();

	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key)
	});
	saveRecentRoom('osr-abcd1234');
	expect(loadRecentRoom()).toBe('OSR-ABCD1234');
	saveRecentRoom('not a room');
	expect(loadRecentRoom()).toBe('OSR-ABCD1234');
	clearRecentRoom();
	expect(loadRecentRoom()).toBeNull();
});

it('fails quietly when storage is unavailable', () => {
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
	expect(loadRecentRoom()).toBeNull();
	expect(() => saveRecentRoom('OSR-ABCD')).not.toThrow();
	expect(() => clearRecentRoom()).not.toThrow();
});
