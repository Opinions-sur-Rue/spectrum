/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { STT_RUNTIMES } from './browser-stt-public-assets';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: ort.InferenceSession | undefined;
let busy = false;
let loaded = false;

scope.onmessage = async ({ data }) => {
	if (busy) {
		scope.postMessage({ type: 'error', id: data?.id });
		return;
	}
	busy = true;
	let runtimeURL: string | undefined;
	let tensors: ort.Tensor[] = [];
	try {
		if (data.type === 'load' && !loaded) {
			loaded = true;
			const moduleURL = `${scope.location.origin}${STT_RUNTIMES.plain.module}`;
			if (
				data.moduleURL !== moduleURL ||
				!(data.runtime instanceof Uint8Array) ||
				!(data.model instanceof Uint8Array)
			)
				throw new Error('Invalid mel initialization');
			runtimeURL = URL.createObjectURL(
				new Blob([data.runtime.buffer], { type: 'application/wasm' })
			);
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.proxy = false;
			ort.env.wasm.wasmPaths = { mjs: moduleURL, wasm: runtimeURL };
			session = await ort.InferenceSession.create(data.model, {
				executionProviders: ['wasm'],
				logSeverityLevel: 3
			});
			scope.postMessage({ type: 'ready', id: data.id });
		} else if (data.type === 'run' && session) {
			if (!(data.audio instanceof Float32Array) || !data.audio.length || data.audio.length > 192000)
				throw new Error('Audio limit');
			const feeds = {
				waveforms: new ort.Tensor('float32', data.audio, [1, data.audio.length]),
				waveforms_lens: new ort.Tensor('int64', BigInt64Array.of(BigInt(data.audio.length)), [1])
			};
			tensors = Object.values(feeds);
			const output = await session.run(feeds);
			tensors.push(...Object.values(output));
			const features = (output.features.data as Float32Array).slice();
			const length = (output.features_lens.data as BigInt64Array).slice();
			scope.postMessage(
				{
					type: 'features',
					id: data.id,
					features,
					dims: output.features.dims,
					length,
					lengthDims: output.features_lens.dims
				},
				[features.buffer, length.buffer]
			);
		} else {
			throw new Error('Invalid mel request');
		}
	} catch {
		await session?.release().catch(() => undefined);
		session = undefined;
		scope.postMessage({ type: 'error', id: data?.id });
		scope.close();
	} finally {
		for (const tensor of tensors) tensor.dispose();
		if (runtimeURL) URL.revokeObjectURL(runtimeURL);
		busy = false;
	}
};
