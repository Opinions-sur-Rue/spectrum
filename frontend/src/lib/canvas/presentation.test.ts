import { describe, expect, it } from 'vitest';
import { publicNote, publicSpectrum } from './presentation';
import type { NoteModel } from './models';
import type { RoomState, SpectrumState } from './room-client';

describe('presentation audience policy', () => {
	it('projects only approved, revealed notes when audience notes are enabled', () => {
		for (const moderation of ['pending', 'rejected', 'approved'] as const) {
			for (const visible of [false, true]) {
				const note = { moderation, visible } as NoteModel;
				expect(publicNote(note, false)).toBe(false);
				expect(publicNote(note, true)).toBe(moderation === 'approved' && visible);
			}
		}
	});
	it('masks all private pellets without mutating admin state', () => {
		const board = { hidden: false, pellets: [{ memberId: 'admin' }] } as SpectrumState;
		const room = { settings: { pelletsVisibleToSpectators: true } } as RoomState;
		expect(publicSpectrum(board, room)).toBe(board);
		expect(publicSpectrum({ ...board, hidden: true }, room).pellets).toEqual([]);
		expect(
			publicSpectrum(board, {
				...room,
				settings: { ...room.settings, pelletsVisibleToSpectators: false }
			}).pellets
		).toEqual([]);
		expect(board.pellets).toHaveLength(1);
	});
});
