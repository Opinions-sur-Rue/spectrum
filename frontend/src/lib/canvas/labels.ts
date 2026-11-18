import { m } from '$lib/paraglide/messages.js';
import type { Relation } from './models';
import type { RoomMember } from './room-client';

export function roleLabel(role: RoomMember['role']): string {
	return role === 'admin'
		? m.v2_role_admin()
		: role === 'participant'
			? m.v2_role_participant()
			: m.v2_role_spectator();
}

export function relationLabel(relation: Relation): string {
	return {
		supports: m.v2_relation_supports(),
		contradicts: m.v2_relation_contradicts(),
		questions: m.v2_relation_questions(),
		extends: m.v2_relation_extends(),
		related: m.v2_relation_related()
	}[relation];
}

/**
 * Visual glyph for a relation. It always accompanies the written label so the
 * meaning never depends on colour alone.
 */
export function relationSymbol(relation: Relation): string {
	return {
		supports: '→',
		contradicts: '≠',
		questions: '?',
		extends: '↗',
		related: '↔'
	}[relation];
}

export const RELATIONS: Relation[] = ['supports', 'contradicts', 'questions', 'extends', 'related'];
