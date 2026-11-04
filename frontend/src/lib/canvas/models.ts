/** Shared models of the v2 canvas. Kept free of Konva so tests and the
 * protocol layer can import them without pulling the renderer in. */

export type Moderation = 'pending' | 'approved' | 'rejected';

export type Relation = 'supports' | 'contradicts' | 'questions' | 'extends' | 'related';

export interface NoteModel {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	title: string;
	markdown: string;
	color: string;
	moderation: Moderation;
	visible: boolean;
	pinned?: boolean;
	authorId: string;
	version?: number;
	createdAt?: string;
}

export interface EdgeModel {
	id: string;
	from: string;
	to: string;
	relation: Relation;
	label: string;
}

export const MODERATION_STROKE: Record<Moderation, string> = {
	pending: '#f59e0b',
	approved: '#22c55e',
	rejected: '#ef4444'
};
