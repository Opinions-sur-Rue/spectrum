import { m } from '$lib/paraglide/messages.js';

/** Known protocol errors get actionable UI copy without changing server codes. */
export function roomErrorLabel(message: string): string {
	switch (message) {
		case 'room not found':
			return m.ux_room_missing();
		case 'room is full':
		case 'spectator limit reached':
			return m.ux_room_full();
		default:
			return message;
	}
}
