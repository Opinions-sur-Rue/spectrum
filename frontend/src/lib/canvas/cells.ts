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
const sourceCache = new Map<string, Promise<string>>();

function loadSpectrumSource(source: string): Promise<string> {
	let result = sourceCache.get(source);
	if (!result) {
		result = fetch(source)
			.then((response) => {
				if (!response.ok) throw new Error('Could not load spectrum geometry');
				return response.text();
			})
			.catch((error) => {
				sourceCache.delete(source);
				throw error;
			});
		sourceCache.set(source, result);
	}
	return result;
}

export function loadSpectrumCells(source: string): Promise<SpectrumCell[]> {
	let result = cache.get(source);
	if (!result) {
		result = loadSpectrumSource(source)
			.then(parseSpectrumCells)
			.catch((error) => {
				cache.delete(source);
				throw error;
			});
		cache.set(source, result);
	}
	return result;
}

/** Mask the two central cells, including their outlined labels, without changing
 * the outer arc or overwriting shared v1 SVG assets. Mask geometry comes from
 * the same exact paths used for hit detection. */
function withoutNeutralCircle(source: string): string {
	const document = new DOMParser().parseFromString(source, 'image/svg+xml');
	const namespace = 'http://www.w3.org/2000/svg';
	const root = document.documentElement;
	const mask = document.createElementNS(namespace, 'mask');
	mask.setAttribute('id', 'v2-neutral-circle-mask');
	mask.setAttribute('maskUnits', 'userSpaceOnUse');
	mask.setAttribute('x', '0');
	mask.setAttribute('y', '0');
	mask.setAttribute('width', '980');
	mask.setAttribute('height', '735');
	mask.setAttribute('style', 'mask-type:luminance');
	const background = document.createElementNS(namespace, 'rect');
	background.setAttribute('width', '980');
	background.setAttribute('height', '735');
	background.setAttribute('fill', 'white');
	mask.append(background);
	for (const id of ['indifferent', 'notReplied']) {
		const shape = document.getElementById(id)?.cloneNode(true) as Element | undefined;
		if (shape) {
			shape.removeAttribute('id');
			shape.setAttribute('style', 'fill:black;stroke:black;stroke-width:2');
			mask.append(shape);
		}
	}
	const drawing = document.createElementNS(namespace, 'g');
	drawing.setAttribute('mask', 'url(#v2-neutral-circle-mask)');
	for (const child of [...root.children]) {
		if (child.namespaceURI === namespace && child.localName !== 'defs') drawing.append(child);
	}
	const definitions = document.createElementNS(namespace, 'defs');
	definitions.append(mask);
	root.append(definitions, drawing);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
}

export async function loadSpectrumGraphic(source: string, showNeutralCircle: boolean) {
	const [text, allCells] = await Promise.all([
		loadSpectrumSource(source),
		loadSpectrumCells(source)
	]);
	return {
		imageSource: showNeutralCircle ? source : withoutNeutralCircle(text),
		labelSource: spectrumLabelGraphic(text, showNeutralCircle),
		cells: showNeutralCircle
			? allCells
			: allCells.filter((cell) => cell.id !== 'indifferent' && cell.id !== 'notReplied')
	};
}

/** Labels may be outlined paths, not SVG text. Remove only the known cell fills. */
export function spectrumLabelGraphic(source: string, showNeutralCircle: boolean): string {
	const svg = showNeutralCircle
		? source
		: decodeURIComponent(withoutNeutralCircle(source).split(',')[1]);
	const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
	for (const id of CELL_IDS) document.getElementById(id)?.remove();
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
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
