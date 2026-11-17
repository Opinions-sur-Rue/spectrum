// Explicit setup only: download public weights once; browsers use same-origin assets.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parakeetRevision, parakeetRepository, parakeetFiles } from './parakeet-assets.mjs';
import { sharedFiles } from './browser-stt-shared-assets.mjs';
import { verifyParakeetAssets } from './verify-parakeet-assets.mjs';

const root = path.resolve(
	process.argv.find((arg) => arg.startsWith('--root='))?.slice(7) ??
		fileURLToPath(new URL('../static/stt/', import.meta.url))
);
const choice = process.argv.find((arg) => arg.startsWith('--model='))?.split('=')[1] ?? 'tiny';
if (!['tiny', 'base', 'small', 'parakeet', 'all'].includes(choice))
	throw new Error('Use --model=tiny|base|small|parakeet|all');
const models = {
	tiny: {
		revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
		encoder: 'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
		decoder: '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
		encoderFp16: '975ccfeb5cb2096ef3ca858cf4e62473aac515a2af115413910a87be4d3e3886',
		decoderFp16: 'b5b6e3f37071723df3f47cf1b448a9672780b015846886336a5e712f02813541'
	},
	base: {
		revision: '64da57285918e20ea79ea5c88eed7197933abaa8',
		encoder: '3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9',
		decoder: 'a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861',
		encoderFp16: 'b12013ba360d247e5af6805590501a94b18f14abb5ba2607f992783adcb23c73',
		decoderFp16: 'd875a521a214f62258f922933e8afe96794c03d571b4039fe08bc9000fb49ddc'
	},
	small: {
		revision: '2d67713f236afa48a18992566e7647f6ca848e13',
		encoderFp16: '6e4af405c8b3e1f97ec74fc009de3112e39f839a3d924761ae089a15d5a70663',
		decoderFp16: '8d0e347441bdac2a62b346bbcb6fc69548651658028ec7e424ecb76c0e09ab9a',
		gpuOnly: true
	}
};
const configs = {
	'config.json': null,
	'generation_config.json': null,
	'preprocessor_config.json': null,
	'tokenizer.json': null,
	'tokenizer_config.json': null,
	'special_tokens_map.json': null,
	'normalizer.json': null
};

async function download(url, destination, checksum) {
	await mkdir(path.dirname(destination), { recursive: true });
	let data;
	try {
		data = await readFile(destination);
	} catch {
		/* Missing setup asset. */
	}
	if (!data || (checksum && createHash('sha256').update(data).digest('hex') !== checksum)) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Public model download failed: ${url} (${response.status})`);
		data = Buffer.from(await response.arrayBuffer());
		if (checksum && createHash('sha256').update(data).digest('hex') !== checksum)
			throw new Error(`Checksum mismatch: ${destination}`);
		await writeFile(destination, data);
	}
}
if (choice === 'parakeet' || choice === 'all') {
	const directory = path.join(root, 'parakeet', parakeetRevision);
	let rawBytes = 0;
	let gzipBytes = 0;
	for (const [file, checksum] of Object.entries(parakeetFiles)) {
		const destination = path.join(directory, file);
		await download(
			`https://huggingface.co/${parakeetRepository}/resolve/${parakeetRevision}/${file}`,
			destination,
			checksum
		);
		const data = await readFile(destination);
		const compressed = gzipSync(data, { level: 9 });
		await writeFile(`${destination}.gz`, compressed);
		rawBytes += data.length;
		gzipBytes += compressed.length;
	}
	await writeFile(
		path.join(directory, 'ATTRIBUTION.txt'),
		`Parakeet Redux by moondream, derived from NVIDIA Parakeet TDT 0.6B v3.\n` +
			`ONNX conversion/quantization by Olicorne. License: CC-BY-4.0.\n` +
			`https://creativecommons.org/licenses/by/4.0/\n` +
			`https://huggingface.co/${parakeetRepository}/tree/${parakeetRevision}\n` +
			`Spectrum uses the published model files unchanged.\n`
	);
	await writeFile(
		path.join(directory, 'manifest.json'),
		JSON.stringify(
			{ revision: parakeetRevision, files: parakeetFiles, rawBytes, gzipBytes },
			null,
			2
		)
	);
	console.info(`Parakeet weights verified: ${rawBytes} raw bytes / ${gzipBytes} gzip bytes`);
}
for (const [name, model] of Object.entries(models)) {
	if (choice !== 'all' && choice !== name) continue;
	const files = {
		...configs,
		'onnx/encoder_model_fp16.onnx': model.encoderFp16,
		'onnx/decoder_model_merged_fp16.onnx': model.decoderFp16,
		...(model.gpuOnly
			? {}
			: {
					'onnx/encoder_model_quantized.onnx': model.encoder,
					'onnx/decoder_model_merged_quantized.onnx': model.decoder
				})
	};
	for (const [file, checksum] of Object.entries(files)) {
		await download(
			`https://huggingface.co/Xenova/whisper-${name}/resolve/${model.revision}/${file}`,
			path.join(root, `models/whisper-${name}`, file),
			checksum
		);
	}
}
const vadRoot =
	'https://raw.githubusercontent.com/snakers4/silero-vad/6478567951ae5c9979ad7b234185b5515f4be7a1';
await download(
	`${vadRoot}/src/silero_vad/data/silero_vad.onnx`,
	path.join(root, 'vad/silero_vad.onnx'),
	'2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f'
);
await download(`${vadRoot}/LICENSE`, path.join(root, 'vad/LICENSE'), sharedFiles['vad/LICENSE']);
await mkdir(path.join(root, 'runtime'), { recursive: true });
for (const file of [
	'ort-wasm-simd-threaded.jsep.mjs',
	'ort-wasm-simd-threaded.jsep.wasm',
	'ort-wasm-simd-threaded.asyncify.mjs',
	'ort-wasm-simd-threaded.asyncify.wasm'
]) {
	await copyFile(
		fileURLToPath(new URL(`../node_modules/onnxruntime-web/dist/${file}`, import.meta.url)),
		path.join(root, 'runtime', file)
	);
}
if (choice === 'parakeet' || choice === 'all') {
	for (const [file, hash] of Object.entries(sharedFiles)) {
		const data = await readFile(path.join(root, file));
		if (createHash('sha256').update(data).digest('hex') !== hash)
			throw new Error(`Shared asset checksum mismatch: ${file}`);
		await writeFile(path.join(root, `${file}.gz`), gzipSync(data, { level: 9 }));
	}
	const { sums, ...sizes } = await verifyParakeetAssets(root);
	await writeFile(path.join(root, 'SHA256SUMS.parakeet'), sums);
	console.info('Parakeet + CPU runtime + VAD verified sizes:', sizes);
}
console.info(
	`Browser STT assets ready (${choice}; Tiny ~75 MB CPU or ~110 MB GPU, Base ~110 MB CPU or ~180 MB GPU, Small GPU ~515 MB, including VAD/runtime). Same-origin inference assets only.`
);
