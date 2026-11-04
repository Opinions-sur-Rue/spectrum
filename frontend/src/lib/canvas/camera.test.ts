import { describe, expect, it } from 'vitest';
import {
	MAX_SCALE,
	MIN_SCALE,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	clampCamera,
	createCamera,
	fitSpectrum,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
	type Viewport
} from './camera';

const viewport: Viewport = { width: 1000, height: 800 };

describe('camera', () => {
	it('maps the camera centre to the viewport centre', () => {
		const camera = { x: 120, y: -80, scale: 2 };
		const screen = worldToScreen(camera, viewport, { x: 120, y: -80 });

		expect(screen).toEqual({ x: 500, y: 400 });
	});

	it('round-trips world and screen coordinates', () => {
		const camera = { x: -300, y: 42, scale: 1.75 };
		const world = { x: 1234, y: -567 };

		const back = screenToWorld(camera, viewport, worldToScreen(camera, viewport, world));

		expect(back.x).toBeCloseTo(world.x);
		expect(back.y).toBeCloseTo(world.y);
	});

	it('clamps the scale between MIN_SCALE and MAX_SCALE', () => {
		expect(clampCamera({ x: 0, y: 0, scale: 100 }, viewport).scale).toBe(MAX_SCALE);
		expect(clampCamera({ x: 0, y: 0, scale: 0.001 }, viewport).scale).toBe(MIN_SCALE);
	});

	it('keeps the viewport inside the world bounds', () => {
		const camera = clampCamera({ x: 999999, y: -999999, scale: 1 }, viewport);

		expect(camera.x).toBe(WORLD_WIDTH / 2 - viewport.width / 2);
		expect(camera.y).toBe(-WORLD_HEIGHT / 2 + viewport.height / 2);
	});

	it('centres the camera when the viewport is larger than the world', () => {
		const huge: Viewport = { width: WORLD_WIDTH + 100, height: WORLD_HEIGHT + 100 };
		const camera = clampCamera({ x: 4000, y: 4000, scale: 1 }, huge);

		expect(camera.x).toBe(0);
		expect(camera.y).toBe(0);
	});

	it('keeps the world point under the cursor fixed when zooming', () => {
		const camera = createCamera();
		const cursor = { x: 250, y: 600 };
		const before = screenToWorld(camera, viewport, cursor);

		const zoomed = zoomAt(camera, viewport, cursor, 2.5);
		const after = screenToWorld(zoomed, viewport, cursor);

		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('does not zoom past the clamp', () => {
		const camera = createCamera();
		const zoomed = zoomAt(camera, viewport, { x: 0, y: 0 }, 999);

		expect(zoomed.scale).toBe(MAX_SCALE);
	});

	it('pans by a screen delta scaled by the zoom', () => {
		const camera = { x: 0, y: 0, scale: 2 };
		const panned = panBy(camera, viewport, 100, -50);

		expect(panned.x).toBe(-50);
		expect(panned.y).toBe(25);
	});

	it('fits the spectrum with padding and stays centred', () => {
		const camera = fitSpectrum(viewport);

		expect(camera.x).toBe(0);
		expect(camera.y).toBe(0);
		expect(camera.scale).toBeGreaterThan(MIN_SCALE);
		expect(camera.scale).toBeLessThanOrEqual(MAX_SCALE);
	});

	it('survives a zero-sized viewport', () => {
		const camera = fitSpectrum({ width: 0, height: 0 });

		expect(Number.isFinite(camera.scale)).toBe(true);
		expect(camera.scale).toBeGreaterThanOrEqual(MIN_SCALE);
	});
});
