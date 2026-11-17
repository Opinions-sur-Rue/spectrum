/**
 * Personal Spectrum notes never reach the server: they live only in this
 * browser, so even a room admin cannot read them. Keyed per room and cleared
 * by saving empty text.
 */
const prefix = 'spectrum-personal-notes:';

function key(roomId: string): string {
	return `${prefix}${roomId}`;
}

export function loadPersonalNotes(roomId: string): string {
	if (!roomId) return '';
	try {
		return localStorage.getItem(key(roomId)) ?? '';
	} catch {
		return '';
	}
}

export function savePersonalNotes(roomId: string, text: string): boolean {
	if (!roomId) return false;
	try {
		if (text) localStorage.setItem(key(roomId), text);
		else localStorage.removeItem(key(roomId));
		return true;
	} catch {
		return false;
	}
}
