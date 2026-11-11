import type { RoomTimerState } from './room-client';

/** Anchor server time to a monotonic clock, not the user's wall clock. */
export class RoomCountdown {
	revision = -1;
	private remaining = 0;
	private receivedAt = 0;

	update(state: RoomTimerState, monotonicNow: number): boolean {
		if (state.revision < this.revision) return false;
		this.revision = state.revision;
		this.remaining = state.endsAt ? Math.max(0, state.endsAt - state.serverNow) : 0;
		this.receivedAt = monotonicNow;
		return true;
	}

	seconds(monotonicNow: number): number {
		return Math.ceil(Math.max(0, this.remaining - (monotonicNow - this.receivedAt)) / 1000);
	}
}

export function timerDuration(
	minutes: number | undefined,
	seconds: number | undefined
): number | null {
	if (
		typeof minutes !== 'number' ||
		typeof seconds !== 'number' ||
		!Number.isInteger(minutes) ||
		!Number.isInteger(seconds) ||
		minutes < 0 ||
		seconds < 0 ||
		seconds > 59
	)
		return null;
	const duration = minutes * 60 + seconds;
	return duration >= 1 && duration <= 86400 ? duration : null;
}

export function timerLabel(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const tail = String(seconds % 60).padStart(2, '0');
	return minutes >= 60
		? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`
		: `${minutes}:${tail}`;
}
