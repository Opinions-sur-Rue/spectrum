import { describe, expect, it } from 'vitest';
import {
	PARAKEET_BLANK,
	parakeetDecision,
	parakeetGreedy,
	parakeetText,
	parakeetVocabulary
} from './parakeet-tdt';

function logits(token: number, duration: number) {
	const values = new Float32Array(8198).fill(-10);
	values[token] = 1;
	values[8193 + duration] = 1;
	return values;
}

describe('Parakeet greedy TDT', () => {
	it('separates token and duration logits, including blank', () => {
		expect(parakeetDecision(logits(PARAKEET_BLANK, 4))).toEqual({
			token: PARAKEET_BLANK,
			duration: 4
		});
		expect(() => parakeetDecision(new Float32Array(8193))).toThrow();
		const invalid = logits(10, 2);
		invalid[30] = NaN;
		expect(() => parakeetDecision(invalid)).toThrow();
	});

	it('carries state only after nonblank and permits zero-duration symbols', async () => {
		const calls: number[][] = [];
		const expected = [
			[10, 0],
			[11, 2],
			[PARAKEET_BLANK, 0],
			[12, 1]
		];
		const tokens = await parakeetGreedy(4, async (frame, previous, state) => {
			calls.push([frame, previous, state[0][0]]);
			const [token, duration] = expected[calls.length - 1];
			return {
				logits: logits(token, duration),
				state: [Float32Array.of(calls.length), Float32Array.of(calls.length)]
			};
		});
		expect(tokens).toEqual([10, 11, 12]);
		expect(calls).toEqual([
			[0, PARAKEET_BLANK, 0],
			[0, 10, 1],
			[2, 11, 2],
			[3, 11, 2]
		]);
	});

	it('bounds loops and frame counts instead of silently dropping text', async () => {
		const step = async () => ({
			logits: logits(10, 0),
			state: [new Float32Array(1280), new Float32Array(1280)] as [Float32Array, Float32Array]
		});
		await expect(parakeetGreedy(1, step)).rejects.toThrow('symbol limit');
		await expect(parakeetGreedy(10000, step)).rejects.toThrow('frame count');
	});

	it('parses IDs strictly and reconstructs SentencePiece text', () => {
		const source = Array.from(
			{ length: 8193 },
			(_, id) =>
				`${id === PARAKEET_BLANK ? '<blk>' : id === 10 ? '▁Bonjour' : id === 11 ? '▁été' : '<unk>'} ${id}`
		).join('\n');
		const vocabulary = parakeetVocabulary(source);
		expect(parakeetText([10, 11, 0, PARAKEET_BLANK], vocabulary)).toBe('Bonjour été');
		expect(() => parakeetVocabulary(source.replace('<unk> 1', '<unk> 9'))).toThrow();
		expect(() => parakeetText([99999], vocabulary)).toThrow();
	});
});
