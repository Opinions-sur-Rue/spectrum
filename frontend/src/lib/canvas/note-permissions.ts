import type { NoteModel } from './models';
import type { RoomState } from './room-client';

export function canEditNote(note: NoteModel, room: RoomState | null): boolean {
	return !!room && room.role !== 'spectator' && note.authorId === room.userId;
}

export function canManageNote(note: NoteModel, room: RoomState | null): boolean {
	return room?.role === 'admin' || canEditNote(note, room);
}
