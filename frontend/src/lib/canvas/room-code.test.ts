import { describe, expect, it } from 'vitest';
import { parseRoomCode } from './room-code';

describe('room invitations', () => {
	it('normalizes codes and accepts a copied code without its prefix', () => {
		expect(parseRoomCode('  osr-abcd1234\n')).toBe('OSR-ABCD1234');
		expect(parseRoomCode('abcd1234')).toBe('OSR-ABCD1234');
		expect(parseRoomCode('OSR-ABCD')).toBe('OSR-ABCD');
	});
	it('extracts v2 query invitations and legacy links without navigating', () => {
		for (const input of [
			'https://spectrum.utile.space/v2?room=osr-abcd1234',
			'/v2?room=OSR-ABCD1234',
			'spectrum.utile.space/v2?room=OSR-ABCD1234',
			'https://spectrum.utile.space/OSR-ABCD1234'
		])
			expect(parseRoomCode(input)).toBe('OSR-ABCD1234');
	});
	it('rejects missing codes, unrelated URLs, unsafe schemes and malformed values', () => {
		for (const input of [
			'',
			'osr-',
			'OSR-ABC',
			'OSR-AB CD',
			'https://example.com/index',
			'/v2',
			'https://example.com/?room=',
			'javascript:alert(1)',
			'file:///OSR-ABCD',
			'https://example.com/%E0%A4%A',
			'OSR-' + 'A'.repeat(65)
		])
			expect(parseRoomCode(input)).toBeNull();
	});
});
