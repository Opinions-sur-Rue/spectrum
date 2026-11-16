import { expect, it } from 'vitest';
import { canEditNote, canManageNote } from './note-permissions';
import type { NoteModel } from './models';
import type { RoomState } from './room-client';

const note = { authorId: 'author', moderation: 'approved' } as NoteModel;
it.each([
	['author', 'admin', true, true],
	['author', 'participant', true, true],
	['author', 'spectator', false, false],
	['other', 'admin', false, true],
	['other', 'participant', false, false],
	['other', 'spectator', false, false]
] as const)(
	'separates content and layout permissions for %s / %s',
	(userId, role, edit, manage) => {
		const room = { userId, role } as RoomState;
		expect(canEditNote(note, room)).toBe(edit);
		expect(canManageNote(note, room)).toBe(manage);
	}
);

it('does not grant permissions without a room', () => {
	expect(canEditNote(note, null)).toBe(false);
	expect(canManageNote(note, null)).toBe(false);
});
