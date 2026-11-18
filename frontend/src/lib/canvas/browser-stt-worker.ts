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
import { ParakeetRuntime } from './parakeet-runtime';
import { STTAssetLoader, STTLoadError, type STTLoadProgress } from './browser-stt-load';
import { PARAKEET_ASSETS, STT_RUNTIMES, VAD_ASSET } from './browser-stt-public-assets';
import { baseDownloadProgress } from './browser-stt-progress';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: WhisperForConditionalGeneration | null = null;
let working = false;
let vad: ort.InferenceSession | null = null;
let backend: 'wasm' | 'webgpu' = 'wasm';
let parakeet: ParakeetRuntime | null = null;
let loadEpoch = 0;

async function watchGPUDevice(epoch: number) {
	if (backend !== 'webgpu') return;
	const device = (await ort.env.webgpu.device) as { lost: Promise<unknown> };
	void device.lost.then(() => {
		if (epoch !== loadEpoch || backend !== 'webgpu') return;
		if (parakeet) {
			void parakeet.release().catch(() => {}); // Retire nested mel worker synchronously.
			parakeet = null;
		}
		// Device loss may otherwise surface as a hung inference or an ORT error
		// containing documentation URLs. Report its known GPU cause directly.
		scope.postMessage({ type: 'error', reason: 'gpu' });
	});
}

scope.onmessage = async ({ data }) => {
	let runtimeURL: string | undefined;
	try {
		if (data.type === 'load') {
			const epoch = ++loadEpoch;
			await parakeet?.release();
			parakeet = null;
			await vad?.release();
			vad = null;
			backend = data.backend ?? 'wasm';
			if (backend !== 'wasm' && backend !== 'webgpu') throw new Error('Unknown backend');
			if (!['base', 'parakeet'].includes(data.model)) throw new Error('Unknown model');
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
				if (!adapter || adapter.info?.isFallbackAdapter !== false)
					throw new Error('Hardware WebGPU unavailable');
				// Whisper uses FP16 weights; the pinned Redux w2a8 encoder uses FP32 activations.
				if (data.model === 'base' && !adapter.features.has('shader-f16'))
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
			const runtime =
				STT_RUNTIMES[
					backend === 'webgpu' ? 'asyncify' : data.model === 'parakeet' ? 'plain' : 'jsep'
				];
			const progress = (value: STTLoadProgress) =>
				scope.postMessage({ type: 'progress', progress: value });
			const assets = new STTAssetLoader(
				[
					runtime.asset,
					VAD_ASSET,
					...(data.model === 'parakeet' ? PARAKEET_ASSETS : []),
					...(data.model === 'parakeet' && backend === 'webgpu'
						? [{ ...STT_RUNTIMES.plain.asset, id: 'mel-runtime' as const }]
						: [])
				],
				progress
			);
			const runtimeBytes = await assets.read('runtime');
			runtimeURL = URL.createObjectURL(
				new Blob([runtimeBytes.buffer as ArrayBuffer], { type: 'application/wasm' })
			);
			wasm.wasmPaths = {
				mjs: `${scope.location.origin}${runtime.module}`,
				wasm: runtimeURL
			};
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.proxy = false;
			ort.env.wasm.wasmPaths = wasm.wasmPaths;
			if (data.model === 'parakeet') {
				parakeet = await ParakeetRuntime.load(assets, backend);
				const vadData = await assets.read('vad');
				assets.initializing('vad');
				vad = await ort.InferenceSession.create(vadData, {
					executionProviders: ['wasm']
				});
				await watchGPUDevice(epoch);
				scope.postMessage({ type: 'ready', backend });
				return;
			}
			// Explicit components avoid pipeline file discovery against a remote Hub.
			const options = {
				progress_callback: (info: {
					status: string;
					file?: string;
					loaded?: number;
					total?: number;
				}) => {
					const value = baseDownloadProgress(info);
					if (value) progress(value);
				}
			};
			const vadData = await assets.read('vad');
			assets.initializing('vad');
			const loaded = await Promise.all([
				AutoProcessor.from_pretrained(modelId, options),
				AutoTokenizer.from_pretrained(modelId, options),
				WhisperForConditionalGeneration.from_pretrained(modelId, {
					...options,
					device: backend,
					dtype: backend === 'webgpu' ? 'fp16' : 'q8'
				}),
				ort.InferenceSession.create(vadData, { executionProviders: ['wasm'] })
			]);
			processor = loaded[0];
			tokenizer = loaded[1];
			model = loaded[2] as WhisperForConditionalGeneration;
			vad = loaded[3];
			await watchGPUDevice(epoch);
			scope.postMessage({ type: 'ready', backend });
		} else if (
			data.type === 'recognize' &&
			(parakeet || (processor && tokenizer && model)) &&
			vad &&
			!working
		) {
			working = true;
			const audio = new Float32Array(data.audio);
			if (audio.length > 16000 * 12) throw new Error('Audio limit exceeded');
			const session = vad;
			const bounds = await browserSpeechBounds(audio, async (input, state) => {
				const feeds = {
					input: new ort.Tensor('float32', input, [1, 576]),
					state: new ort.Tensor('float32', state, [2, 1, 128]),
					sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), [])
				};
				let result: Record<string, ort.Tensor> = {};
				try {
					result = await session.run(feeds);
					return {
						probability: Number(result.output.data[0]),
						state: (result.stateN.data as Float32Array).slice()
					};
				} finally {
					for (const tensor of [...Object.values(result), ...Object.values(feeds)])
						tensor.dispose();
				}
			});
			if (!bounds) {
				scope.postMessage({ type: 'result', id: data.id, text: '', language: '', noSpeech: true });
				working = false;
				return;
			}
			if (parakeet) {
				if (data.language !== 'fr' && data.language !== 'en')
					throw new Error('Parakeet requires a pinned room language');
				const text = await parakeet.recognize(audio.subarray(bounds.start, bounds.end));
				scope.postMessage({ type: 'result', id: data.id, text, language: data.language });
				working = false;
				return;
			}
			if (!processor || !tokenizer || !model) throw new Error('Model unavailable');
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
	} catch (error) {
		working = false;
		if (parakeet) {
			// release() retires the nested mel worker synchronously. A lost GPU's
			// session release must not block reporting the original failure.
			void parakeet.release().catch(() => {});
			parakeet = null;
		}
		// Transformers' Base loader does not use STTLoadError. Never turn a
		// failed/missing download into a GPU retry with another weight variant.
		const message = error instanceof Error ? error.message : '';
		const assetFailure =
			/integrity|checksum|sha256|404|403|not found|could not locate|missing.*(?:asset|file|model)|(?:asset|file|model).*missing/i.test(
				message
			);
		const downloadFailure =
			/failed to fetch|fetch failed|download|network(?:error| error)|http\s*(?:error|[45]\d\d)/i.test(
				message
			);
		const reason =
			error instanceof STTLoadError
				? error.reason
				: assetFailure
					? 'assets'
					: downloadFailure
						? 'download'
						: /consent|permission|notallowederror/i.test(message)
							? 'failed'
							: backend === 'webgpu'
								? 'gpu'
								: data.type === 'load'
									? 'engine'
									: 'failed';
		scope.postMessage({ type: 'error', reason }); // Never log raw audio, text or model exceptions.
	} finally {
		if (runtimeURL) URL.revokeObjectURL(runtimeURL);
	}
};
