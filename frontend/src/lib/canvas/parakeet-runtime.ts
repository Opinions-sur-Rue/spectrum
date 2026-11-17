import * as ort from 'onnxruntime-web/webgpu';
import { parakeetGreedy, parakeetText, parakeetVocabulary } from './parakeet-tdt';
import type { STTAssetLoader, STTAssetId } from './browser-stt-load';

function dispose(values: Record<string, ort.Tensor>) {
	for (const tensor of Object.values(values)) tensor.dispose();
}

export class ParakeetRuntime {
	private constructor(
		private mel: ort.InferenceSession,
		private encoder: ort.InferenceSession,
		private joint: ort.InferenceSession,
		private vocabulary: string[]
	) {}

	static async load(assets: STTAssetLoader) {
		const sessions: ort.InferenceSession[] = [];
		try {
			const vocabulary = parakeetVocabulary(
				new TextDecoder().decode(await assets.read('vocabulary'))
			);
			for (const id of ['features', 'encoder', 'decoder'] as STTAssetId[]) {
				const data = await assets.read(id);
				assets.initializing(id);
				sessions.push(
					await ort.InferenceSession.create(data, {
						executionProviders: ['wasm'],
						logSeverityLevel: 3
					})
				);
			}
			return new ParakeetRuntime(sessions[0], sessions[1], sessions[2], vocabulary);
		} catch (error) {
			await Promise.allSettled(sessions.map((session) => session.release()));
			throw error;
		}
	}

	async recognize(audio: Float32Array): Promise<string> {
		if (!audio.length || audio.length > 16000 * 12) throw new Error('Audio limit');
		const input = {
			waveforms: new ort.Tensor('float32', audio, [1, audio.length]),
			waveforms_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(audio.length)]), [1])
		};
		let features: Record<string, ort.Tensor> = {};
		let encoded: Record<string, ort.Tensor> = {};
		try {
			features = await this.mel.run(input);
			encoded = await this.encoder.run({
				audio_signal: features.features,
				length: features.features_lens
			});
			const output = encoded.outputs;
			const width = output.dims[2];
			const frames = Number(encoded.encoded_lengths.data[0]);
			if (output.dims[0] !== 1 || output.dims[1] !== 1024 || frames > width)
				throw new Error('Unexpected encoder shape');
			const tokens = await parakeetGreedy(frames, async (frame, previous, state) => {
				const sample = new Float32Array(1024);
				for (let channel = 0; channel < 1024; channel++)
					sample[channel] = Number(output.data[channel * width + frame]);
				const feeds = {
					encoder_outputs: new ort.Tensor('float32', sample, [1, 1024, 1]),
					targets: new ort.Tensor('int32', Int32Array.of(previous), [1, 1]),
					target_length: new ort.Tensor('int32', Int32Array.of(1), [1]),
					input_states_1: new ort.Tensor('float32', state[0], [2, 1, 640]),
					input_states_2: new ort.Tensor('float32', state[1], [2, 1, 640])
				};
				let result: Record<string, ort.Tensor> = {};
				try {
					result = await this.joint.run(feeds);
					return {
						logits: (result.outputs.data as Float32Array).slice(),
						state: [
							(result.output_states_1.data as Float32Array).slice(),
							(result.output_states_2.data as Float32Array).slice()
						] as [Float32Array, Float32Array]
					};
				} finally {
					dispose(result);
					dispose(feeds);
				}
			});
			const text = parakeetText(tokens, this.vocabulary);
			if (text.length > 4000) throw new Error('Transcript limit');
			return text;
		} finally {
			dispose(encoded);
			dispose(features);
			dispose(input);
		}
	}
}
