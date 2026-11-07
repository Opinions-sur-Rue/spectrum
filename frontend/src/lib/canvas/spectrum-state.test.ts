import { describe, expect, it } from 'vitest';
import { applySpectrumMovement, mergeSpectrumSnapshot } from './spectrum-state';
import type { SpectrumState } from './room-client';

function snapshot(): SpectrumState {
	return {
		revision: 10,
		topic: '',
		sliceCount: 7,
		hidden: false,
		pellets: [
			{ memberId: 'a', nickname: 'Alice', color: 'ffffff', x: 100, y: 200, version: 2 },
			{ memberId: 'b', nickname: 'Bob', color: '000000', x: 300, y: 400, version: 2 }
		]
	};
}

describe('spectrum synchronization', () => {
	it('does not revive an old layout or neutral circle from a delayed snapshot', () => {
		const previous = { ...snapshot(), showNeutralCircle: true };
		const configured = mergeSpectrumSnapshot(previous, {
			...previous,
			revision: 11,
			sliceCount: 3,
			showNeutralCircle: false
		});
		expect(mergeSpectrumSnapshot(configured, previous)).toBe(configured);
		expect(configured.sliceCount).toBe(3);
		expect(configured.showNeutralCircle).toBe(false);
	});
	it('keeps independent participant movements even if messages arrive in reverse order', () => {
		let current = snapshot();
		current = applySpectrumMovement(current, {
			revision: 10,
			memberId: 'b',
			x: 350,
			y: 450,
			version: 4
		});
		current = applySpectrumMovement(current, {
			revision: 10,
			memberId: 'a',
			x: 150,
			y: 250,
			version: 3
		});
		expect(current.pellets.map((pellet) => pellet.x)).toEqual([150, 350]);
		expect(
			applySpectrumMovement(current, { revision: 10, memberId: 'b', x: 1, y: 1, version: 3 })
		).toBe(current);
	});
	it('does not roll back a recent delta when an older snapshot arrives', () => {
		const current = applySpectrumMovement(snapshot(), {
			revision: 10,
			memberId: 'a',
			x: 150,
			y: 250,
			version: 3
		});
		expect(mergeSpectrumSnapshot(current, snapshot()).pellets[0].x).toBe(150);
	});
	it('never revives hidden or demoted pellets from delayed snapshots or deltas', () => {
		const hidden = mergeSpectrumSnapshot(snapshot(), {
			...snapshot(),
			revision: 11,
			hidden: true,
			pellets: []
		});
		expect(mergeSpectrumSnapshot(hidden, snapshot())).toBe(hidden);
		expect(
			applySpectrumMovement(hidden, { revision: 10, memberId: 'a', x: 10, y: 20, version: 5 })
		).toBe(hidden);
		expect(
			applySpectrumMovement(hidden, { revision: 11, memberId: 'a', x: 10, y: 20, version: 5 })
		).toBe(hidden);
	});
	it('requires a fresh filtered snapshot before accepting new structural revisions', () => {
		const current = snapshot();
		expect(
			applySpectrumMovement(current, { revision: 11, memberId: 'new', x: 10, y: 20, version: 1 })
		).toBe(current);
	});
});
