import { expect, it } from 'vitest';
import { floatingLayout } from './floating-layout';

const bounds = { x: 0, y: 0, width: 800, height: 600 };

it('places a header menu below its trigger and clamps at both horizontal edges', () => {
	const panel = { width: 300, height: 200 };
	expect(floatingLayout({ x: 10, y: 10, width: 40, height: 40 }, panel, bounds)).toMatchObject({
		x: 8,
		y: 58,
		side: 'below'
	});
	expect(floatingLayout({ x: 790, y: 10, width: 40, height: 40 }, panel, bounds).x).toBe(492);
});

it('flips a dock above a note near the canvas bottom', () => {
	const placed = floatingLayout(
		{ x: 300, y: 400, width: 200, height: 160 },
		{ width: 200, height: 180 },
		bounds,
		'center',
		10
	);
	expect(placed).toMatchObject({ x: 300, y: 210, side: 'above' });
});

it.each([bounds, { x: 20, y: 100, width: 320, height: 240 }, { x: 0, y: 0, width: 1, height: 1 }])(
	'keeps oversized panels inside visible bounds (%j)',
	(viewport) => {
		const placed = floatingLayout(
			{ x: 500, y: 500, width: 100, height: 100 },
			{ width: 1200, height: 1600 },
			viewport
		);
		expect(placed.x).toBeGreaterThanOrEqual(viewport.x);
		expect(placed.y).toBeGreaterThanOrEqual(viewport.y);
		expect(placed.x + placed.width).toBeLessThanOrEqual(viewport.x + viewport.width);
		expect(placed.y + placed.height).toBeLessThanOrEqual(viewport.y + viewport.height);
	}
);
