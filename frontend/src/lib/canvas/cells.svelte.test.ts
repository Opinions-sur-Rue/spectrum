import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CELL_IDS, spectrumLabelGraphic } from './cells';

it.each([
	'spectrum.svg',
	'spectrum_3.svg',
	'spectrum_5.svg',
	'spectrum_9.svg',
	'spectrum_en.svg',
	'spectrum_en_3.svg',
	'spectrum_en_5.svg',
	'spectrum_en_9.svg'
])('keeps original outlined labels without cell fills in %s', (name) => {
	const source = readFileSync(`${process.cwd()}/static/${name}`, 'utf8');
	for (const central of [true, false]) {
		const image = spectrumLabelGraphic(source, central);
		const text = decodeURIComponent(image.slice(image.indexOf(',') + 1));
		const svg = new DOMParser().parseFromString(text, 'image/svg+xml');
		expect(svg.querySelector('parsererror')).toBeNull();
		for (const id of CELL_IDS) expect(svg.getElementById(id)).toBeNull();
		expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
		if (!central) {
			expect(svg.querySelector('g[mask="url(#v2-neutral-circle-mask)"]')).not.toBeNull();
			expect(svg.querySelectorAll('mask path')).toHaveLength(2);
		}
	}
});
