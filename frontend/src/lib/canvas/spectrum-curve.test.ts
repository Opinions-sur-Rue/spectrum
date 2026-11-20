import { expect, it } from 'vitest';
import { simplifySpectrum, spectrumDrift, spectrumHeight, spectrumSector } from './spectrum-curve';

it('reduces visual resolution to 12 bands while preserving silence, flat energy and frequency order', () => {
	expect(simplifySpectrum(Array(32).fill(0))).toEqual(Array(12).fill(0));
	expect(simplifySpectrum(Array(32).fill(1))).toEqual(Array(12).fill(1));
	const bass = Array(32).fill(0);
	bass[2] = 1;
	const treble = Array(32).fill(0);
	treble[28] = 1;
	const low = simplifySpectrum(bass);
	const high = simplifySpectrum(treble);
	expect(low.indexOf(Math.max(...low))).toBeLessThan(4);
	expect(high.indexOf(Math.max(...high))).toBeGreaterThanOrEqual(8);
});

it('scales the complete envelope to 70 percent', () => {
	const bands = Array(12).fill(1);
	expect(spectrumSector(bands, 0, 4, 10, undefined, 0.7)).toMatch(/^M 0.000,-19.450 /);
});

it('adds bounded continuous idle noise without a seam or replacing FFT peaks', () => {
	for (let t = 0; t < 20; t += 0.1) {
		expect(Math.abs(spectrumDrift(1, t))).toBeLessThanOrEqual(0.3);
		expect(Math.abs(spectrumDrift(1, t + 0.04) - spectrumDrift(1, t))).toBeLessThan(0.01);
		expect(spectrumDrift(0, t)).toBeCloseTo(spectrumDrift(Math.PI * 2, t));
	}
	const silent = Array(32).fill(0);
	expect(spectrumSector(silent, 0, 10, 10, 0)).not.toBe(spectrumSector(silent, 0, 10, 10, 1));
});

it('passes through every FFT height, including separate peaks in the same group', () => {
	const bands = Array(32).fill(0);
	bands[2] = 0.9;
	bands[6] = 0.6;
	for (let i = 0; i < bands.length; i++) {
		expect(spectrumHeight(bands, i)).toBeCloseTo(bands[i]);
	}
	expect(spectrumHeight(bands, 4)).toBe(0);
});

it('interpolates smoothly without exceeding adjacent band heights and wraps the seam', () => {
	const bands = [0, 1, 0.3, 0.5];
	expect(spectrumHeight(bands, 0.5)).toBeCloseTo(0.5);
	for (let i = 0; i < 4; i++) {
		for (let step = 0; step <= 20; step++) {
			const value = spectrumHeight(bands, i + step / 20);
			expect(value).toBeGreaterThanOrEqual(Math.min(bands[i], bands[(i + 1) % 4]));
			expect(value).toBeLessThanOrEqual(Math.max(bands[i], bands[(i + 1) % 4]));
		}
	}
	expect(spectrumHeight(bands, 4)).toBe(0);
	expect(spectrumHeight(bands, -0.5)).toBeCloseTo(spectrumHeight(bands, 3.5));
});

it('keeps a filled silent baseline and locates bass and treble at different angles', () => {
	const silent = Array(32).fill(0);
	const bass = [...silent];
	const treble = [...silent];
	bass[4] = 1;
	treble[28] = 1;
	expect(spectrumSector(silent, 0, 10, 10)).toMatch(/^M 0.000,-11.500 .* Z$/);
	expect(spectrumSector(bass, 0, 10, 10)).not.toBe(spectrumSector(silent, 0, 10, 10));
	expect(spectrumSector(treble, 0, 10, 10)).toBe(spectrumSector(silent, 0, 10, 10));
	expect(spectrumSector(treble, 21, 32, 10)).not.toBe(spectrumSector(silent, 21, 32, 10));
});
