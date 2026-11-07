import { expect, it, vi } from 'vitest';
import { browserSpeechBounds } from './browser-stt-vad';

it('rejects sustained loud non-speech and isolated positive frames', async () => {
	const audio = new Float32Array(16000).fill(0.4);
	expect(
		await browserSpeechBounds(audio, async () => ({
			probability: 0.01,
			state: new Float32Array(256)
		}))
	).toBeNull();
	let frame = 0;
	expect(
		await browserSpeechBounds(audio, async () => ({
			probability: frame++ < 3 ? 0.95 : 0.01,
			state: new Float32Array(256)
		}))
	).toBeNull();
});

it('keeps speech with padding while carrying context and recurrent state', async () => {
	const audio = Float32Array.from({ length: 16000 }, (_, i) => i / 16000);
	let frame = 0;
	const run = vi.fn(async (input: Float32Array, state: Float32Array) => {
		expect(input).toHaveLength(576);
		expect(state[0]).toBe(frame);
		if (frame) expect(input[0]).toBe(audio[frame * 512 - 64]);
		const probability = frame >= 10 && frame < 20 ? 0.9 : 0.01;
		frame++;
		return { probability, state: new Float32Array(256).fill(frame) };
	});
	expect(await browserSpeechBounds(audio, run)).toEqual({ start: 1920, end: 13440 });
	expect(run).toHaveBeenCalledTimes(32);
	// Each new candidate resets recurrent state; no previous utterance leaks in.
	frame = 0;
	await browserSpeechBounds(audio, run);
});

it('fails closed on corrupt output or oversized audio', async () => {
	await expect(
		browserSpeechBounds(new Float32Array(512), async () => ({
			probability: NaN,
			state: new Float32Array(256)
		}))
	).rejects.toThrow('Invalid VAD output');
	const run = vi.fn();
	await expect(browserSpeechBounds(new Float32Array(16000 * 12 + 1), run)).rejects.toThrow(
		'Invalid VAD audio size'
	);
	expect(run).not.toHaveBeenCalled();
});
