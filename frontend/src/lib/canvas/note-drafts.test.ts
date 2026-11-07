import { expect, it } from 'vitest';
import { NoteDrafts } from './note-drafts';
import type { NoteModel } from './models';
import type { RoomState } from './room-client';

const room = { roomId: 'room', userId: 'author', role: 'participant' } as RoomState;
const note = { id: 'note', authorId: 'author', moderation: 'pending' } as NoteModel;
const draft = { markdown: 'Unsent words', baseMarkdown: 'Saved words', baseVersion: 2 };

it('keeps RAM drafts until an authoritative snapshot permits restoration', () => {
	const drafts = new NoteDrafts();
	drafts.enter(room);
	drafts.set(note.id, draft);
	// Re-entering the same identity after reconnect does not erase unsaved work.
	drafts.enter({ ...room });
	drafts.reconcile([note], room);
	expect(drafts.get(note.id)).toEqual(draft);
	// Preserve the old base version so a changed server note becomes a conflict.
	drafts.reconcile([{ ...note, version: 9 }], room);
	expect(drafts.get(note.id)?.baseVersion).toBe(2);
});

it.each([
	{ ...room, roomId: 'other' },
	{ ...room, userId: 'other' },
	{ ...room, role: 'spectator' as const },
	{ ...room, role: 'admin' as const }
])('clears drafts when room, identity or authority changes (%j)', (next) => {
	const drafts = new NoteDrafts();
	drafts.enter(room);
	drafts.set(note.id, draft);
	drafts.enter(next);
	expect(drafts.get(note.id)).toBeUndefined();
});

it.each([
	{ notes: [] },
	{ notes: [{ ...note, authorId: 'another' }] },
	{ notes: [{ ...note, moderation: 'approved' as const }] }
])('prunes deleted or no-longer-editable notes from fresh snapshots (%j)', ({ notes }) => {
	const drafts = new NoteDrafts();
	drafts.enter(room);
	drafts.set(note.id, draft);
	drafts.reconcile(notes, room);
	expect(drafts.get(note.id)).toBeUndefined();
});

it('allows admin edits but clears saved, cancelled and closed-room drafts', () => {
	const drafts = new NoteDrafts();
	const admin = { ...room, role: 'admin' as const };
	drafts.enter(admin);
	drafts.set(note.id, draft);
	drafts.reconcile([{ ...note, moderation: 'approved', authorId: 'another' }], admin);
	expect(drafts.get(note.id)).toEqual(draft);
	drafts.set(note.id, { ...draft, markdown: draft.baseMarkdown });
	expect(drafts.get(note.id)).toBeUndefined();
	drafts.set(note.id, draft);
	drafts.delete(note.id);
	expect(drafts.get(note.id)).toBeUndefined();
	drafts.set(note.id, draft);
	drafts.clear();
	expect(drafts.get(note.id)).toBeUndefined();
});
