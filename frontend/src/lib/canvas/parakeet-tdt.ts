/** Independent greedy TDT decoding for the pinned Redux graph (not an RNNT loop). */
export const PARAKEET_BLANK = 8192;
export const PARAKEET_TOKENS = 8193;
export const PARAKEET_DURATIONS = 5;

export function parakeetDecision(logits: ArrayLike<number>) {
	if (logits.length !== PARAKEET_TOKENS + PARAKEET_DURATIONS)
		throw new Error('Unexpected TDT logits');
	const best = (start: number, end: number) => {
		let winner = start;
		for (let index = start; index < end; index++) {
			if (!Number.isFinite(logits[index])) throw new Error('Non-finite TDT logits');
			if (logits[index] > logits[winner]) winner = index;
		}
		return winner;
	};
	return {
		token: best(0, PARAKEET_TOKENS),
		duration: best(PARAKEET_TOKENS, logits.length) - PARAKEET_TOKENS
	};
}

export function parakeetVocabulary(source: string): string[] {
	const tokens: string[] = [];
	for (const line of source.trim().split(/\r?\n/)) {
		const match = /^(.*) (\d+)$/.exec(line);
		if (!match) throw new Error('Invalid vocabulary');
		const id = Number(match[2]);
		if (id !== tokens.length) throw new Error('Invalid vocabulary order');
		tokens.push(match[1]);
	}
	if (tokens.length !== PARAKEET_TOKENS || tokens[PARAKEET_BLANK] !== '<blk>')
		throw new Error('Unexpected vocabulary');
	return tokens;
}

export function parakeetText(tokens: number[], vocabulary: string[]): string {
	return tokens
		.map((id) => {
			const piece = vocabulary[id];
			if (piece === undefined) throw new Error('Unknown token');
			return /^<.*>$/.test(piece) ? '' : piece;
		})
		.join('')
		.replace(/▁/g, ' ')
		.trim();
}

export interface ParakeetStep {
	logits: ArrayLike<number>;
	state: [Float32Array, Float32Array];
}

export async function parakeetGreedy(
	frames: number,
	step: (
		frame: number,
		previous: number,
		state: [Float32Array, Float32Array]
	) => Promise<ParakeetStep>
): Promise<number[]> {
	if (!Number.isInteger(frames) || frames < 1 || frames > 160)
		throw new Error('Invalid frame count');
	let state: [Float32Array, Float32Array] = [new Float32Array(1280), new Float32Array(1280)];
	let frame = 0;
	let previous = PARAKEET_BLANK;
	let repeats = 0;
	const tokens: number[] = [];
	while (frame < frames) {
		const result = await step(frame, previous, state);
		const { token, duration } = parakeetDecision(result.logits);
		if (token !== PARAKEET_BLANK) {
			tokens.push(token);
			previous = token;
			state = result.state;
		}
		// A blank with zero duration must advance; nonblank zero-duration symbols
		// may share one frame. Reject pathological loops rather than hang a worker.
		const advance = token === PARAKEET_BLANK ? Math.max(1, duration) : duration;
		if (!advance && ++repeats > 16) throw new Error('TDT symbol limit');
		if (advance) repeats = 0;
		frame += advance;
	}
	return tokens;
}
