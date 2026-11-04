import type { SpectrumMovement, SpectrumState } from './room-client';

/** Structural revisions prevent delayed snapshots reviving hidden/demoted pellets. */
export function mergeSpectrumSnapshot(
	current: SpectrumState | null,
	incoming: SpectrumState
): SpectrumState {
	if (!current) return incoming;
	if (incoming.revision < current.revision) return current;
	return {
		...incoming,
		pellets: incoming.pellets.map((pellet) => {
			const previous = current.pellets.find((value) => value.memberId === pellet.memberId);
			return previous && previous.version > pellet.version
				? { ...pellet, x: previous.x, y: previous.y, version: previous.version }
				: pellet;
		})
	};
}

/** Never insert a pellet from a delta: only filtered server snapshots grant visibility. */
export function applySpectrumMovement(
	current: SpectrumState,
	movement: SpectrumMovement
): SpectrumState {
	if (movement.revision !== current.revision) return current;
	const existing = current.pellets.find((pellet) => pellet.memberId === movement.memberId);
	if (!existing || movement.version <= existing.version) return current;
	return {
		...current,
		pellets: current.pellets.map((pellet) =>
			pellet.memberId === movement.memberId
				? { ...pellet, x: movement.x, y: movement.y, version: movement.version }
				: pellet
		)
	};
}
