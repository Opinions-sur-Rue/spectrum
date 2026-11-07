import { describe, expect, it } from 'vitest';
import { BrowserSTTSegmenter } from './browser-stt-segmenter';

describe('bounded browser PCM segmentation', () => {
	it('ignores silence and tiny noises', () => {
		const segmenter = new BrowserSTTSegmenter();
		for (let i = 0; i < 10000; i++) expect(segmenter.push(new Float32Array(320))).toBeNull();
		segmenter.push(new Float32Array(320).fill(0.1));
		for (let i = 0; i < 40; i++) expect(segmenter.push(new Float32Array(320))).toBeNull();
	});
	it('finalizes after 800ms silence and retains bounded preroll', () => {
		const segmenter = new BrowserSTTSegmenter();
		for (let i = 0; i < 100; i++) segmenter.push(new Float32Array(320));
		for (let i = 0; i < 50; i++) expect(segmenter.push(new Float32Array(320).fill(0.1))).toBeNull();
		for (let i = 0; i < 39; i++) expect(segmenter.push(new Float32Array(320))).toBeNull();
		const chunk = segmenter.push(new Float32Array(320));
		expect(chunk?.start).toBe(1800);
		expect(chunk?.end).toBe(3800);
		expect(chunk?.audio.length).toBe(32000);
	});
	it('caps continuous speech at eight seconds without overlap', () => {
		const segmenter = new BrowserSTTSegmenter();
		const chunks = [];
		for (let i = 0; i < 1200; i++) {
			const chunk = segmenter.push(new Float32Array(320).fill(0.1));
			if (chunk) chunks.push(chunk);
		}
		expect(chunks.map(({ start, end }) => [start, end])).toEqual([
			[0, 8000],
			[8000, 16000],
			[16000, 24000]
		]);
		expect(chunks.every(({ audio }) => audio.length === 128000)).toBe(true);
	});
});
