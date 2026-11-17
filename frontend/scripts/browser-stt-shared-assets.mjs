// Must match package-lock.json's pinned onnxruntime-web build. Updating ORT
// requires explicitly reviewing these fingerprints and browser smoke results.
export const sharedFiles = {
	'vad/silero_vad.onnx': '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f',
	'vad/LICENSE': '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b',
	'runtime/ort-wasm-simd-threaded.jsep.mjs':
		'c2f80e915e9df63289788a99d434d8c4e00e64e9c1f030f4b80b022458dd2c99',
	'runtime/ort-wasm-simd-threaded.jsep.wasm':
		'62ff86b2f2fa3a79eb87a7e4720e8ea9051942bf975f314181bf7dcef2feac06',
	'runtime/ort-wasm-simd-threaded.asyncify.mjs':
		'0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611',
	'runtime/ort-wasm-simd-threaded.asyncify.wasm':
		'49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082'
};
