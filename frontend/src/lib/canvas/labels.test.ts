import { expect, it } from 'vitest';
import { relationLabel, relationSymbol, RELATIONS } from './labels';

it('names every relation with a distinct non-colour glyph', () => {
	const symbols = RELATIONS.map(relationSymbol);
	expect(symbols.every((symbol) => symbol.trim().length > 0)).toBe(true);
	expect(new Set(symbols).size).toBe(RELATIONS.length);
	expect(RELATIONS.map(relationLabel).every((label) => label.trim().length > 0)).toBe(true);
});
