import { m } from '$lib/paraglide/messages.js';

/** Known protocol errors get actionable UI copy without changing server codes. */
export function roomErrorLabel(message: string, code?: string): string {
	if (code === 'room_join_failed' && message === 'operation not allowed for this role')
		return m.ux_error_leave_room_first();
	switch (message) {
		case 'room not found':
		case 'room already closed':
		case 'room closed':
		case 'The room was closed by an admin.':
			return m.ux_room_missing();
		case 'room is full':
		case 'spectator limit reached':
			return m.ux_room_full();
		case 'operation not allowed for this role':
		case 'user is not an admin':
		case 'user is not a participant':
		case 'speaker is not on stage':
			return m.ux_error_permission();
		case 'message must contain 1–1000 characters':
			return m.ux_error_chat_content();
		case 'please wait a moment before sending another message':
			return m.ux_error_chat_rate();
		case 'voice service unavailable':
			return m.ux_error_voice_unavailable();
		case 'client is not signed in':
		case 'client is not in a room':
			return m.ux_connection_unavailable();
		case 'already in a room':
			return m.ux_error_already_in_room();
		case 'room needs another admin first':
			return m.ux_error_last_admin();
		default:
			// Never display raw SDK/server sentences, stack traces or URLs as UI copy.
			return m.ux_error_generic();
	}
}
