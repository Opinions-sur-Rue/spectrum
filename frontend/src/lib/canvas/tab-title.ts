/** Keep the tab title informative so admins can follow a room from another tab.
 * Silent by design: no title flashing loop, no notification permission. */
const DEFAULT_TITLE = 'Spectrum v2 — canvas';

let room: string | null = null;
let timer: string | null = null;

export function composeTitle(
	currentRoom: string | null = room,
	currentTimer: string | null = timer
): string {
	if (currentTimer) return `⏱ ${currentTimer} · Spectrum v2`;
	if (currentRoom) return `Spectrum v2 · ${currentRoom}`;
	return DEFAULT_TITLE;
}

function apply(): void {
	if (typeof document !== 'undefined') document.title = composeTitle();
}

export function setTabRoom(value: string | null): void {
	if (room === value) return;
	room = value;
	apply();
}

export function setTabTimer(value: string | null): void {
	if (timer === value) return;
	timer = value;
	apply();
}

export function resetTabTitle(): void {
	room = null;
	timer = null;
	apply();
}
