import { describe, expect, it } from 'vitest';
import {
	MAX_SCALE,
	MIN_SCALE,
	SPECTRUM_HEIGHT,
	SPECTRUM_WIDTH,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	clampCamera,
	createCamera,
	fitSpectrum,
	isContentVisible,
	keepContentVisible,
	panBy,
	screenToWorld,
	worldToScreen,
	zoomAt,
	type ContentRect,
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

describe('resize camera policy', () => {
	const spectrum: ContentRect = {
		x: -SPECTRUM_WIDTH / 2,
		y: -SPECTRUM_HEIGHT / 2,
		width: SPECTRUM_WIDTH,
		height: SPECTRUM_HEIGHT
	};
	const phone: Viewport = { width: 390, height: 844 };

	it('keeps a deliberate pan and zoom while any content is visible', () => {
		const camera = { x: -600, y: 0, scale: 1.4 };
		const kept = keepContentVisible(camera, viewport, [spectrum]);

		expect(kept).toBe(camera);
		expect(isContentVisible(camera, viewport, spectrum)).toBe(true);
	});

	it('pans minimally back to the nearest content when the view is empty', () => {
		const camera = { x: 0, y: 2000, scale: 1.2 };
		const rescued = keepContentVisible(camera, phone, [spectrum]);

		expect(isContentVisible(rescued, phone, spectrum)).toBe(true);
		expect(rescued.scale).toBe(1.2);
		expect(rescued.y).toBeLessThan(2000);
	});

	it('prefers the nearest note over the spectrum when both are offscreen', () => {
		const note: ContentRect = { x: 140, y: 1500, width: 260, height: 180 };
		const camera = { x: 300, y: 2200, scale: 1 };
		const rescued = keepContentVisible(camera, phone, [spectrum, note]);

		expect(isContentVisible(rescued, phone, note)).toBe(true);
		expect(rescued.y).toBe(1680);
		expect(rescued.scale).toBe(1);
	});

	it('does nothing without content', () => {
		const camera = { x: 100, y: 100, scale: 1 };
		expect(keepContentVisible(camera, viewport, [])).toBe(camera);
	});
});
