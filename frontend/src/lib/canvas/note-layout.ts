import { WORLD_WIDTH, WORLD_HEIGHT } from './camera';
import type { NoteModel } from './models';

export const MIN_NOTE_WIDTH = 220;
export const MIN_NOTE_HEIGHT = 140;
export const MAX_NOTE_WIDTH = 1200;
export const MAX_NOTE_HEIGHT = 1200;

export function clampNoteSize(note: NoteModel, width: number, height: number) {
	return {
		width: Math.min(
			Math.max(
				MIN_NOTE_WIDTH,
				Math.min(MAX_NOTE_WIDTH, Number.isFinite(width) ? width : note.width)
			),
			WORLD_WIDTH / 2 - note.x
		),
		height: Math.min(
			Math.max(
				MIN_NOTE_HEIGHT,
				Math.min(MAX_NOTE_HEIGHT, Number.isFinite(height) ? height : note.height)
			),
			WORLD_HEIGHT / 2 - note.y
		)
	};
}
