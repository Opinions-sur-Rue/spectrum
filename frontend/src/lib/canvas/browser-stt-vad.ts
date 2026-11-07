/** Silero v5: 512 samples at 16 kHz, 64 samples of context, recurrent state.
 * Run on bounded candidate chunks before Whisper, never on the UI thread.
 */
export type VADRun = (
	input: Float32Array,
	state: Float32Array
) => Promise<{ probability: number; state: Float32Array }>;

export async function browserSpeechBounds(
	audio: Float32Array,
	run: VADRun
): Promise<{ start: number; end: number } | null> {
	if (!audio.length || audio.length > 16000 * 12) throw new Error('Invalid VAD audio size');
	let state: Float32Array = new Float32Array(256);
	let context = new Float32Array(64);
	let first = -1;
	let last = 0;
	let speechSamples = 0;
	for (let offset = 0; offset < audio.length; offset += 512) {
		const input = new Float32Array(576);
		input.set(context);
		input.set(audio.subarray(offset, offset + 512), 64);
		const output = await run(input, state);
		if (
			!Number.isFinite(output.probability) ||
			output.probability < 0 ||
			output.probability > 1 ||
			output.state.length !== 256
		)
			throw new Error('Invalid VAD output');
		state = output.state;
		context = input.slice(-64);
		if (output.probability >= 0.5) {
			if (first < 0) first = offset;
			last = Math.min(offset + 512, audio.length);
			speechSamples += last - offset;
		}
	}
	// Reject isolated clicks and predominantly non-speech chunks. This is a gate,
	// not a guarantee against hallucination; short utterances can be missed.
	if (first < 0 || speechSamples < 4096 || speechSamples / audio.length < 0.1) return null;
	return { start: Math.max(0, first - 3200), end: Math.min(audio.length, last + 3200) };
}
