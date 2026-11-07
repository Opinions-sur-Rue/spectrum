import type { NoteModel } from './models';
import type { RoomState } from './room-client';

export interface NoteDraft {
	markdown: string;
	baseMarkdown: string;
	baseVersion: number | undefined;
}

/** Tab-local RAM only. Authoritative room/canvas state gates every restoration. */
export class NoteDrafts {
	private scope = '';
	private drafts = new Map<string, NoteDraft>();

	enter(room: RoomState) {
		const scope = JSON.stringify([room.roomId, room.userId, room.role]);
		if (scope !== this.scope) this.clear();
		this.scope = scope;
	}

	reconcile(notes: NoteModel[], room: RoomState) {
		this.enter(room);
		const editable = new Set(
			notes
				.filter(
					(note) =>
						room.role === 'admin' ||
						(room.role === 'participant' &&
							note.authorId === room.userId &&
							note.moderation !== 'approved')
				)
				.map((note) => note.id)
		);
		for (const id of this.drafts.keys()) if (!editable.has(id)) this.drafts.delete(id);
	}

	get(id: string): NoteDraft | undefined {
		return this.drafts.get(id);
	}

	set(id: string, draft: NoteDraft) {
		if (draft.markdown === draft.baseMarkdown) this.delete(id);
		else this.drafts.set(id, { ...draft });
	}

	delete(id: string) {
		this.drafts.delete(id);
	}

	clear() {
		this.drafts.clear();
		this.scope = '';
	}
}
