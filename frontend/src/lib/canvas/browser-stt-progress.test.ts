import { expect, it } from 'vitest';
import { baseDownloadProgress } from './browser-stt-progress';

it('uses pinned decoded sizes instead of compressed or expanding transport totals', () => {
	const progress = baseDownloadProgress({
		status: 'progress',
		file: 'onnx/encoder_model_quantized.onnx',
		loaded: 10000000,
		total: 1000000
	});
	expect(progress).toMatchObject({
		loaded: 10000000,
		total: 23200850,
		phase: 'download',
		fileOnly: true
	});
});

it('handles basename/path variants, bounds percentages, and does not invent unknown file totals', () => {
	expect(
		baseDownloadProgress({
			status: 'progress',
			file: 'decoder_model_merged_fp16.onnx',
			loaded: 200000000,
			total: 1
		})?.loaded
	).toBe(104742968);
	expect(
		baseDownloadProgress({
			status: 'progress',
			file: '/stt/models/whisper-base/tokenizer.json?x=1',
			loaded: 1,
			total: 1
		})?.total
	).toBe(2480466);
	expect(
		baseDownloadProgress({ status: 'progress', file: 'unknown.bin', loaded: 1, total: 1 })
	).toBeNull();
	expect(
		baseDownloadProgress({ status: 'progress', file: 'tokenizer.json', loaded: NaN })
	).toBeNull();
	expect(baseDownloadProgress({ status: 'ready' })?.phase).toBe('initializing');
});
