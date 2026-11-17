/** Compact, locale-neutral duration for speaking totals (both fr and en use these units). */
export function formatSpeakingTime(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	if (total < 60) return `${total} s`;
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

/** Server total wins once known; the state snapshot seeds members who spoke earlier. */
export function speakingSecondsFor(
	memberId: string,
	snapshot: number | undefined,
	updates: Record<string, number>
): number {
	return Math.max(snapshot ?? 0, updates[memberId] ?? 0);
}
