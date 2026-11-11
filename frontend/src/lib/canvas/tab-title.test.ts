import { expect, it } from 'vitest';
import { composeTitle } from './tab-title';

it('shows the countdown first, then the room, then the default title', () => {
	expect(composeTitle(null, null)).toBe('Spectrum v2 — canvas');
	expect(composeTitle('OSR-ABCD1234', null)).toBe('Spectrum v2 · OSR-ABCD1234');
	expect(composeTitle('OSR-ABCD1234', '4:32')).toBe('⏱ 4:32 · Spectrum v2');
	expect(composeTitle('OSR-ABCD1234', 'Time is up')).toBe('⏱ Time is up · Spectrum v2');
});
