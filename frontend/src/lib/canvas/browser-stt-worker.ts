/// <reference lib="webworker" />
import {
	env,
	AutoProcessor,
	AutoTokenizer,
	Tensor,
	WhisperForConditionalGeneration
} from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { browserSpeechBounds } from './browser-stt-vad';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: WhisperForConditionalGeneration | null = null;
let working = false;
let vad: ort.InferenceSession | null = null;
let backend: 'wasm' | 'webgpu' = 'wasm';

scope.onmessage = async ({ data }) => {
	try {
		if (data.type === 'load') {
			backend = data.backend ?? 'wasm';
			if (backend !== 'wasm' && backend !== 'webgpu') throw new Error('Unknown backend');
			if (!['tiny', 'base', 'small'].includes(data.model)) throw new Error('Unknown model');
			if (data.model === 'small' && backend !== 'webgpu') throw new Error('Small requires WebGPU');
			if (backend === 'webgpu') {
				// Fail before downloading weights when a real GPU is unavailable.
				const adapter = await (
					scope.navigator as unknown as {
						gpu?: {
							requestAdapter(options?: {
								powerPreference?: 'low-power' | 'high-performance';
							}): Promise<{
								info?: { isFallbackAdapter?: boolean };
								features: { has(name: string): boolean };
							} | null>;
						};
					}
				).gpu?.requestAdapter({ powerPreference: 'high-performance' });
				if (!adapter || adapter.info?.isFallbackAdapter || !adapter.features.has('shader-f16'))
					throw new Error('Hardware WebGPU with FP16 unavailable');
				ort.env.webgpu.adapter = adapter as typeof ort.env.webgpu.adapter;
			}
			// v4 treats bare names as Hub IDs instead of resolving localModelPath.
			// An explicit same-origin path keeps every component on our own server.
			const modelId = `/stt/models/whisper-${data.model}`;
			env.allowRemoteModels = false;
			env.allowLocalModels = true;
			// Root-relative path is required for Transformers' local file discovery.
			env.localModelPath = '/stt/models/';
			env.useBrowserCache = true; // Public weights only, never audio or transcripts.
			const wasm = env.backends.onnx.wasm!;
			wasm.numThreads = 1;
			wasm.proxy = false;
			const runtime = backend === 'webgpu' ? 'asyncify' : 'jsep';
			wasm.wasmPaths = {
				mjs: `${scope.location.origin}/stt/runtime/ort-wasm-simd-threaded.${runtime}.mjs`,
				wasm: `${scope.location.origin}/stt/runtime/ort-wasm-simd-threaded.${runtime}.wasm`
			};
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.proxy = false;
			ort.env.wasm.wasmPaths = wasm.wasmPaths;
			// Explicit components avoid pipeline file discovery against a remote Hub.
			const options = { progress_callback: () => scope.postMessage({ type: 'progress' }) };
			const loaded = await Promise.all([
				AutoProcessor.from_pretrained(modelId, options),
				AutoTokenizer.from_pretrained(modelId, options),
				WhisperForConditionalGeneration.from_pretrained(modelId, {
					...options,
					device: backend,
					dtype: backend === 'webgpu' ? 'fp16' : 'q8'
				}),
				ort.InferenceSession.create('/stt/vad/silero_vad.onnx', { executionProviders: ['wasm'] })
			]);
			processor = loaded[0];
			tokenizer = loaded[1];
			model = loaded[2] as WhisperForConditionalGeneration;
			vad = loaded[3];
			scope.postMessage({ type: 'ready', backend });
		} else if (data.type === 'recognize' && processor && tokenizer && model && vad && !working) {
			working = true;
			const audio = new Float32Array(data.audio);
			if (audio.length > 16000 * 12) throw new Error('Audio limit exceeded');
			const session = vad;
			const bounds = await browserSpeechBounds(audio, async (input, state) => {
				const result = await session.run({
					input: new ort.Tensor('float32', input, [1, 576]),
					state: new ort.Tensor('float32', state, [2, 1, 128]),
					sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [])
				});
				return {
					probability: Number(result.output.data[0]),
					state: result.stateN.data as Float32Array
				};
			});
			if (!bounds) {
				scope.postMessage({ type: 'result', id: data.id, text: '', language: '', noSpeech: true });
				working = false;
				return;
			}
			const features = await processor(audio.subarray(bounds.start, bounds.end));
			let language = data.language;
			if (language === 'auto') {
				// Transformers v4 otherwise silently defaults to English. Let Whisper
				// predict one language token, then admit only FR/EN for transcription.
				const detection = model._prepare_generation_config(null, {
					max_new_tokens: 1,
					num_beams: 1,
					do_sample: false,
					language: undefined,
					task: undefined,
					return_timestamps: false,
					suppress_tokens: null,
					begin_suppress_tokens: null
				});
				const identified = await model.generate({
					...detection,
					generation_config: detection,
					inputs: features.input_features,
					decoder_input_ids: new Tensor(
						'int64',
						BigInt64Array.from([BigInt(detection.decoder_start_token_id)]),
						[1, 1]
					)
				});
				if (!(identified instanceof Tensor)) throw new Error('Invalid language output');
				language = tokenizer
					.decode(identified.tolist()[0], { skip_special_tokens: false })
					.match(/<\|(fr|en)\|>/)?.[1];
				if (!language) {
					scope.postMessage({ type: 'result', id: data.id, text: '', language: '' });
					working = false;
					return;
				}
			}
			const config = model._prepare_generation_config(null, {
				task: 'transcribe',
				language,
				max_new_tokens: 128,
				num_beams: 1,
				do_sample: false,
				return_timestamps: false
			});
			const output = await model.generate({
				...config,
				generation_config: config,
				inputs: features.input_features
			});
			if (!(output instanceof Tensor)) throw new Error('Invalid ASR output');
			const tokens = output.tolist()[0];
			const tagged = tokenizer.decode(tokens, { skip_special_tokens: false });
			const detected = tagged.match(/<\|(fr|en)\|>/)?.[1] ?? language;
			let text = tokenizer.decode(tokens, { skip_special_tokens: true }).trim().slice(0, 4000);
			if (detected !== 'fr' && detected !== 'en') text = '';
			if (/^(?:sous.titres.*amara\.org|subtitles by the amara\.org community)[.!]?$/i.test(text))
				text = '';
			scope.postMessage({ type: 'result', id: data.id, text, language: detected });
			working = false;
		}
	} catch {
		working = false;
		scope.postMessage({ type: 'error', reason: backend === 'webgpu' ? 'gpu' : 'failed' }); // Never log raw audio, text or model exceptions.
	}
};
