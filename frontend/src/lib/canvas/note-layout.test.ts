import { describe, expect, it } from 'vitest';
import { clampNoteSize } from './note-layout';
import type { NoteModel } from './models';

const note: NoteModel = {
	id: 'note',
	x: 0,
	y: 0,
	width: 360,
	height: 340,
	title: '',
	markdown: '',
	color: '',
	moderation: 'approved',
	visible: false,
	authorId: ''
};
describe('note resizing', () => {
	it('clamps minimum and maximum dimensions', () => {
		expect(clampNoteSize(note, 1, 1)).toEqual({ width: 220, height: 140 });
		expect(clampNoteSize(note, 9999, 9999)).toEqual({ width: 1200, height: 1200 });
	});
	it('keeps the origin fixed at world edges', () => {
		expect(clampNoteSize({ ...note, x: 5640, y: 3660 }, 1000, 1000)).toEqual({
			width: 360,
			height: 340
		});
	});
	it('ignores non-finite dimensions', () => {
		expect(clampNoteSize(note, NaN, Infinity)).toEqual({ width: 360, height: 340 });
	});
});
