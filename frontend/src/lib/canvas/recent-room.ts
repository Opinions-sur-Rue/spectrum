/** Remember only the last room code, never notes or credentials. */
const KEY = 'spectrum-recent-room';

export function parseRecentRoom(value: string | null | undefined): string | null {
	const candidate = value?.trim().toUpperCase() ?? '';
	return /^OSR-[A-Z0-9]{4,64}$/.test(candidate) ? candidate : null;
}

export function loadRecentRoom(): string | null {
	try {
		return parseRecentRoom(localStorage.getItem(KEY));
	} catch {
		return null;
	}
}

export function saveRecentRoom(roomId: string): void {
	const value = parseRecentRoom(roomId);
	if (!value) return;
	try {
		localStorage.setItem(KEY, value);
	} catch {
		/* Storage may be disabled. */
	}
}

export function clearRecentRoom(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* Storage may be disabled. */
	}
}
