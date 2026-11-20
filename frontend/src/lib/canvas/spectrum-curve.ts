/** Smooth periodic interpolation through FFT bar heights, without overshoot. */
export function spectrumHeight(bands: readonly number[], position: number): number {
	if (!bands.length) return 0;
	const index = Math.floor(position);
	const fraction = position - index;
	const at = (i: number) => {
		const value = bands[((i % bands.length) + bands.length) % bands.length];
		return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
	};
	const blend = (1 - Math.cos(fraction * Math.PI)) / 2;
	return at(index) * (1 - blend) + at(index + 1) * blend;
}

/** Low-amplitude coherent noise; periodic around the circle, continuous in time. */
export function spectrumDrift(angle: number, seconds: number): number {
	return (
		0.2 * Math.sin(3 * angle + seconds * 0.7) + 0.1 * Math.sin(5 * angle - seconds * 0.43 + 1.2)
	);
}

/** Filled frequency sector: bass starts at twelve o'clock, frequencies clockwise. */
export function spectrumSector(
	bands: readonly number[],
	from: number,
	to: number,
	base: number,
	seconds?: number,
	amplitude = 1
): string {
	if (!bands.length) return '';
	const steps = Math.ceil((to - from) * 8);
	const point = (position: number, radius: number) => {
		const angle = (position / bands.length) * Math.PI * 2 - Math.PI / 2;
		return `${(Math.cos(angle) * radius).toFixed(3)},${(Math.sin(angle) * radius).toFixed(3)}`;
	};
	const points: string[] = [];
	for (let step = 0; step <= steps; step++) {
		const position = from + ((to - from) * step) / steps;
		const drift =
			seconds === undefined ? 0 : spectrumDrift((position / bands.length) * Math.PI * 2, seconds);
		points.push(
			point(position, base + amplitude * (1.5 + drift + 12 * spectrumHeight(bands, position)))
		);
	}
	for (let step = steps; step >= 0; step--) {
		points.push(point(from + ((to - from) * step) / steps, base));
	}
	return `M ${points.join(' L ')} Z`;
}
export const SPECTRUM_VISUAL_BANDS = 12;

/** Reduce visual detail only; retain energy across the complete FFT range. */
export function simplifySpectrum(bands: readonly number[]): number[] {
	if (!bands.length) return [];
	return Array.from({ length: SPECTRUM_VISUAL_BANDS }, (_, index) => {
		const from = (index * bands.length) / SPECTRUM_VISUAL_BANDS;
		const to = ((index + 1) * bands.length) / SPECTRUM_VISUAL_BANDS;
		let power = 0;
		for (let i = Math.floor(from); i < Math.ceil(to); i++) {
			const weight = Math.min(to, i + 1) - Math.max(from, i);
			power += weight * bands[i] ** 2;
		}
		return Math.sqrt(power / (to - from));
	});
}
