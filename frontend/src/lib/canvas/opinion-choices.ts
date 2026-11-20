import { createCellDetector, type SpectrumCell } from './cells';

export interface OpinionChoice {
	id: SpectrumCell['id'];
	x: number;
	y: number;
}

/** Pick verified interior points from the actual layout, not guessed sector angles. */
export function opinionChoices(
	cells: SpectrumCell[],
	detect = createCellDetector(cells)
): OpinionChoice[] {
	const points = new Map<string, { x: number; y: number }[]>();
	for (let y = 20; y <= 715; y += 12) {
		for (let x = 20; x <= 960; x += 12) {
			const cell = detect(x, y);
			if (!cell) continue;
			if (!points.has(cell.id)) points.set(cell.id, []);
			points.get(cell.id)!.push({ x, y });
		}
	}
	return cells.flatMap(({ id }) => {
		const samples = points.get(id);
		if (!samples?.length) return [];
		const center = samples.reduce(
			(sum, point) => ({
				x: sum.x + point.x / samples.length,
				y: sum.y + point.y / samples.length
			}),
			{ x: 0, y: 0 }
		);
		const interior = samples.filter(({ x, y }) =>
			[
				[x - 8, y],
				[x + 8, y],
				[x, y - 8],
				[x, y + 8]
			].every(([a, b]) => detect(a, b)?.id === id)
		);
		const candidates = interior.length ? interior : samples;
		const point = candidates.reduce((best, item) =>
			Math.hypot(item.x - center.x, item.y - center.y) <
			Math.hypot(best.x - center.x, best.y - center.y)
				? item
				: best
		);
		return [{ id, ...point }];
	});
}
