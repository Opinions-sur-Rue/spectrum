import {
	SPECTRUM_HEIGHT,
	SPECTRUM_WIDTH,
	clampCamera,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	type Camera,
	type Point,
	type Viewport
} from './camera';
import type { NoteModel } from './models';

/** Prefer nearby free space, without covering the fixed spectrum on creation. */
export function nextNotePosition(camera: Camera, notes: NoteModel[]): Point {
	const width = 360,
		height = 340;
	const center = { x: camera.x - width / 2, y: camera.y - height / 2 };
	const columns = [
		center.x,
		center.x + width + 30,
		center.x - width - 30,
		SPECTRUM_WIDTH / 2 + 50,
		-SPECTRUM_WIDTH / 2 - width - 50
	];
	for (let row = 0; row <= notes.length + 2; row++) {
		const offset = Math.ceil(row / 2) * (height + 40) * (row % 2 ? 1 : -1);
		for (const x of columns) {
			const y = center.y + offset;
			if (
				x < -WORLD_WIDTH / 2 ||
				x + width > WORLD_WIDTH / 2 ||
				y < -WORLD_HEIGHT / 2 ||
				y + height > WORLD_HEIGHT / 2
			)
				continue;
			if (
				x < SPECTRUM_WIDTH / 2 &&
				x + width > -SPECTRUM_WIDTH / 2 &&
				y < SPECTRUM_HEIGHT / 2 &&
				y + height > -SPECTRUM_HEIGHT / 2
			)
				continue;
			if (
				notes.some(
					(note) =>
						x < note.x + note.width + 20 &&
						x + width + 20 > note.x &&
						y < note.y + note.height + 20 &&
						y + height + 20 > note.y
				)
			)
				continue;
			return { x, y };
		}
	}
	return {
		x: Math.max(-WORLD_WIDTH / 2, Math.min(WORLD_WIDTH / 2 - width, center.x)),
		y: Math.max(-WORLD_HEIGHT / 2, Math.min(WORLD_HEIGHT / 2 - height, center.y))
	};
}

/** Pan just enough to keep a new card and its attached controls on screen. */
export function revealNote(camera: Camera, viewport: Viewport, point: Point): Camera {
	if (viewport.width <= 48 || viewport.height <= 48) return camera;
	const scale = Math.min(camera.scale, (viewport.width - 48) / 360, (viewport.height - 48) / 520);
	const next = clampCamera({ ...camera, scale }, viewport);
	const left = (point.x - next.x) * next.scale + viewport.width / 2;
	const right = left + 360 * next.scale;
	const top = (point.y - 30 - next.y) * next.scale + viewport.height / 2;
	const bottom = top + 520 * next.scale;
	if (left < 24) next.x -= (24 - left) / next.scale;
	else if (right > viewport.width - 24) next.x += (right - viewport.width + 24) / next.scale;
	if (top < 24) next.y -= (24 - top) / next.scale;
	else if (bottom > viewport.height - 24) next.y += (bottom - viewport.height + 24) / next.scale;
	return clampCamera(next, viewport);
}

/** Frame an existing card using its real size, leaving room for canvas controls. */
export function focusNote(
	camera: Camera,
	viewport: Viewport,
	note: Pick<NoteModel, 'x' | 'y' | 'width' | 'height'>
): Camera {
	if (viewport.width <= 48 || viewport.height <= 100) return camera;
	const scale = Math.min(
		Math.max(camera.scale, 0.8),
		(viewport.width - 48) / note.width,
		(viewport.height - 100) / note.height
	);
	const next = clampCamera(
		{ x: note.x + note.width / 2, y: note.y + note.height / 2, scale },
		viewport
	);
	return clampCamera({ ...next, y: next.y + 26 / next.scale }, viewport);
}
