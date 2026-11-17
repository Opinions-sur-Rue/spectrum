import type { STTLoadProgress } from './browser-stt-load';

// Decoded sizes for the pinned Xenova/whisper-base revision in setup-browser-stt.
// Content-Length may describe gzip bytes, not the bytes emitted by Fetch streams.
const baseFileBytes: Record<string, number> = {
	'config.json': 2248,
	'generation_config.json': 3776,
	'tokenizer_config.json': 282683,
	'tokenizer.json': 2480466,
	'special_tokens_map.json': 2194,
	'preprocessor_config.json': 339,
	'normalizer.json': 52666,
	'onnx/encoder_model_quantized.onnx': 23200850,
	'onnx/decoder_model_merged_quantized.onnx': 53707539,
	'onnx/encoder_model_fp16.onnx': 41333198,
	'onnx/decoder_model_merged_fp16.onnx': 104742968
};

export function baseDownloadProgress(info: {
	status: string;
	file?: string;
	loaded?: number;
	total?: number;
}): STTLoadProgress | null {
	if (info.status === 'done' || info.status === 'ready')
		return { phase: 'initializing', loaded: 0, total: 0, asset: 'model', fileOnly: true };
	if (info.status !== 'progress' || !Number.isFinite(info.loaded) || info.loaded! < 0) return null;
	const file = info.file?.split('?')[0];
	const entry = Object.entries(baseFileBytes).find(
		([path]) => file === path || file === path.split('/').at(-1) || file?.endsWith('/' + path)
	);
	// Never invent percentages for a future, unrecognized component.
	if (!entry) return null;
	return {
		phase: 'download',
		asset: 'model',
		fileOnly: true,
		loaded: Math.min(info.loaded!, entry[1]),
		total: entry[1]
	};
}
