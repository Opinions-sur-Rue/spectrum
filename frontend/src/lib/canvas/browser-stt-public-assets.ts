import type { STTPublicAsset } from './browser-stt-load';
export const PARAKEET_ROOT = '/stt/parakeet/de66c10f18f6d94cb3e910e48034e45ce51109bc';
export const VAD_ASSET: STTPublicAsset = {
	id: 'vad',
	url: '/stt/vad/silero_vad.onnx',
	bytes: 2327524,
	sha256: '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f'
};
export const PARAKEET_ASSETS: STTPublicAsset[] = [
	{
		id: 'vocabulary',
		url: `${PARAKEET_ROOT}/vocab.txt`,
		bytes: 93939,
		sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
	},
	{
		id: 'features',
		url: `${PARAKEET_ROOT}/nemo128.onnx`,
		bytes: 139764,
		sha256: 'a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f'
	},
	{
		id: 'encoder',
		url: `${PARAKEET_ROOT}/w2a8/encoder-model.w2a8.onnx`,
		bytes: 189893007,
		sha256: '7cf42a2785f1d009bdff79d2e9f57165a372923bbfd46c3d65bbd0e332225353'
	},
	{
		id: 'decoder',
		url: `${PARAKEET_ROOT}/int8/decoder_joint-model.int8.onnx`,
		bytes: 18203490,
		sha256: 'c729ceaebd43ef6581890079505d04ab5b40c0b7a87ca1f78ad6054c1eae3144'
	}
];
export const STT_RUNTIMES = {
	plain: {
		asset: {
			id: 'runtime',
			url: '/stt/runtime/ort-wasm-simd-threaded.wasm',
			bytes: 14264838,
			sha256: '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3'
		} as STTPublicAsset,
		module:
			'/stt/runtime/ort-wasm-simd-threaded.mjs?sha256=c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f'
	},
	jsep: {
		asset: {
			id: 'runtime',
			url: '/stt/runtime/ort-wasm-simd-threaded.jsep.wasm',
			bytes: 28352885,
			sha256: '62ff86b2f2fa3a79eb87a7e4720e8ea9051942bf975f314181bf7dcef2feac06'
		} as STTPublicAsset,
		module:
			'/stt/runtime/ort-wasm-simd-threaded.jsep.mjs?sha256=c2f80e915e9df63289788a99d434d8c4e00e64e9c1f030f4b80b022458dd2c99'
	},
	asyncify: {
		asset: {
			id: 'runtime',
			url: '/stt/runtime/ort-wasm-simd-threaded.asyncify.wasm',
			bytes: 26861777,
			sha256: '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082'
		} as STTPublicAsset,
		module:
			'/stt/runtime/ort-wasm-simd-threaded.asyncify.mjs?sha256=0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611'
	}
};
