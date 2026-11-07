/**
 * Camera maths for the v2 infinite canvas.
 *
 * Pure functions only: no Konva, no Svelte, no DOM. The camera stores the
 * world coordinates of the viewport centre, so the same camera works at any
 * container size.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface Camera {
	/** World x of the viewport centre. */
	x: number;
	/** World y of the viewport centre. */
	y: number;
	/** Screen pixels per world unit. */
	scale: number;
}

export const WORLD_WIDTH = 12000;
export const WORLD_HEIGHT = 8000;
export const SPECTRUM_WIDTH = 980;
export const SPECTRUM_HEIGHT = 735;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;

/** Padding kept around the spectrum when fitting it in the viewport. */
const FIT_PADDING = 64;

export function createCamera(): Camera {
	return { x: 0, y: 0, scale: 1 };
}

function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Clamps the scale and keeps the viewport inside the world bounds. */
export function clampCamera(camera: Camera, viewport: Viewport): Camera {
	const scale = clampScale(camera.scale);
	const halfWorldWidth = WORLD_WIDTH / 2;
	const halfWorldHeight = WORLD_HEIGHT / 2;

	const halfViewWidth = viewport.width / (2 * scale);
	const halfViewHeight = viewport.height / (2 * scale);

	const x =
		halfViewWidth >= halfWorldWidth
			? 0
			: Math.min(
					halfWorldWidth - halfViewWidth,
					Math.max(-halfWorldWidth + halfViewWidth, camera.x)
				);

	const y =
		halfViewHeight >= halfWorldHeight
			? 0
			: Math.min(
					halfWorldHeight - halfViewHeight,
					Math.max(-halfWorldHeight + halfViewHeight, camera.y)
				);

	return { x, y, scale };
}

export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): Point {
	return {
		x: (point.x - camera.x) * camera.scale + viewport.width / 2,
		y: (point.y - camera.y) * camera.scale + viewport.height / 2
	};
}

export function screenToWorld(camera: Camera, viewport: Viewport, point: Point): Point {
	return {
		x: (point.x - viewport.width / 2) / camera.scale + camera.x,
		y: (point.y - viewport.height / 2) / camera.scale + camera.y
	};
}

/** Zooms while keeping the world point under the cursor fixed. */
export function zoomAt(
	camera: Camera,
	viewport: Viewport,
	screenPoint: Point,
	nextScale: number
): Camera {
	const scale = clampScale(nextScale);
	const anchor = screenToWorld(camera, viewport, screenPoint);

	const x = anchor.x - (screenPoint.x - viewport.width / 2) / scale;
	const y = anchor.y - (screenPoint.y - viewport.height / 2) / scale;

	return clampCamera({ x, y, scale }, viewport);
}

/** Pans by a screen-pixel delta. */
export function panBy(camera: Camera, viewport: Viewport, dx: number, dy: number): Camera {
	return clampCamera(
		{
			x: camera.x - dx / camera.scale,
			y: camera.y - dy / camera.scale,
			scale: camera.scale
		},
		viewport
	);
}

/** Camera that fits the whole spectrum zone, centred, with some padding. */
export function fitSpectrum(viewport: Viewport): Camera {
	const width = viewport.width > 0 ? viewport.width : SPECTRUM_WIDTH + FIT_PADDING * 2;
	const height = viewport.height > 0 ? viewport.height : SPECTRUM_HEIGHT + FIT_PADDING * 2;
	const padding = Math.min(FIT_PADDING, Math.max(20, width * 0.04));

	const scale = clampScale(
		Math.min((width - padding * 2) / SPECTRUM_WIDTH, (height - padding * 2) / SPECTRUM_HEIGHT)
	);

	return clampCamera({ x: 0, y: 0, scale }, viewport);
}
