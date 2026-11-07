import type { NoteModel } from './models';
import type { RoomState, SpectrumState } from './room-client';

/** Renderer-only audience policy; never changes membership or stored drafts. */
export function publicNote(note: NoteModel, audienceEnabled: boolean): boolean {
	return audienceEnabled && note.moderation === 'approved' && note.visible;
}

export function publicSpectrum(board: SpectrumState, room: RoomState): SpectrumState {
	return board.hidden || !room.settings.pelletsVisibleToSpectators
		? { ...board, pellets: [] }
		: board;
}
