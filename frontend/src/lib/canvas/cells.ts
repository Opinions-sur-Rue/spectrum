import { m } from '$lib/paraglide/messages.js';

export const CELL_IDS = [
	'absolutelyDisagree',
	'stronglyDisagree',
	'disagree',
	'slightlyDisagree',
	'neutral',
	'slightlyAgree',
	'agree',
	'stronglyAgree',
	'absolutelyAgree',
	'indifferent',
	'notReplied'
] as const;
export type SpectrumCellID = (typeof CELL_IDS)[number];
export interface SpectrumCell {
	id: SpectrumCellID;
	path: string;
}

export function parseSpectrumCells(source: string): SpectrumCell[] {
	const document = new DOMParser().parseFromString(source, 'image/svg+xml');
	if (document.querySelector('parsererror')) throw new Error('Invalid spectrum SVG');
	return CELL_IDS.flatMap((id) => {
		const shape = document.getElementById(id);
		if (!shape) return [];
		if (shape.localName !== 'path' || shape.closest('[transform]'))
			throw new Error(`Unsupported spectrum cell: ${id}`);
		const path = shape.getAttribute('d');
		return path ? [{ id, path }] : [];
	});
}

const cache = new Map<string, Promise<SpectrumCell[]>>();
export function loadSpectrumCells(source: string): Promise<SpectrumCell[]> {
	let result = cache.get(source);
	if (!result) {
		result = fetch(source)
			.then((response) => {
				if (!response.ok) throw new Error('Could not load spectrum geometry');
				return response.text();
			})
			.then(parseSpectrumCells)
			.catch((error) => {
				cache.delete(source);
				throw error;
			});
		cache.set(source, result);
	}
	return result;
}

/** Test pellet centers against the exact SVG curves, in unscaled spectrum units. */
export function createCellDetector(
	cells: SpectrumCell[]
): (x: number, y: number) => SpectrumCell | null {
	if (!cells.length) return () => null;
	const context = document.createElement('canvas').getContext('2d');
	if (!context) throw new Error('Canvas geometry unavailable');
	const paths = cells.map((cell) => ({ cell, path: new Path2D(cell.path) }));
	return (x, y) =>
		Number.isFinite(x) && Number.isFinite(y)
			? (paths.find(({ path }) => context.isPointInPath(path, x, y))?.cell ?? null)
			: null;
}

export function cellLabel(id: SpectrumCellID | null): string {
	const labels: Record<SpectrumCellID, () => string> = {
		absolutelyDisagree: m.opinion_absolutely_disagree,
		stronglyDisagree: m.opinion_strongly_disagree,
		disagree: m.opinion_disagree,
		slightlyDisagree: m.opinion_slightly_disagree,
		neutral: m.opinion_neutral,
		slightlyAgree: m.opinion_slightly_agree,
		agree: m.opinion_agree,
		stronglyAgree: m.opinion_strongly_agree,
		absolutelyAgree: m.opinion_absolutely_agree,
		indifferent: m.opinion_indifferent,
		notReplied: m.opinion_not_replied
	};
	return id ? labels[id]() : '';
}
