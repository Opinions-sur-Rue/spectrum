import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_HISTORY_LIMIT, ActivityTracker, type ActivityEntry } from './activity-state';
import type { RoomMember, RoomState, SpectrumState, LiveState } from './room-client';
import type { SpectrumCellID } from './cells';

const a: RoomMember = { id: 'm_a', nickname: 'Alice', role: 'admin', color: 'ffffff' };
const b: RoomMember = { id: 'm_b', nickname: 'Bob', role: 'participant', color: '000000' };
const detect = (x: number, y: number): { id: SpectrumCellID } => ({
	id: y > 500 ? 'notReplied' : x > 600 ? 'agree' : 'neutral'
});
function scene(topic = 'First claim'): SpectrumState {
	return {
		revision: 1,
		topic,
		sliceCount: 7,
		showNeutralCircle: true,
		hidden: false,
		pellets: [a, b].map((member) => ({
			memberId: member.id,
			nickname: member.nickname,
			color: member.color!,
			x: 490,
			y: 580,
			version: 0
		}))
	};
}
function room(
	spectrum: SpectrumState,
	members = [a, b],
	role: RoomState['role'] = 'admin'
): RoomState {
	return {
		roomId: 'room',
		userId: 'm_a',
		role,
		members,
		spectrum,
		settings: {
			participantSlots: 6,
			spectatorLimit: 50,
			notesVisibleToSpectators: false,
			pelletsVisibleToSpectators: true,
			spectatorChatEnabled: false
		}
	};
}

describe('tab-local activity journal', () => {
	let entries: ActivityEntry[];
	let tracker: ActivityTracker;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		entries = [];
		tracker = new ActivityTracker((value) => {
			entries = value;
		});
	});
	afterEach(() => {
		tracker.destroy();
		vi.useRealTimers();
	});
	const opinions = (entries: ActivityEntry[]) =>
		entries.filter((entry) => entry.kind === 'opinion');
	it('journals observed live transitions, not initial state or reconnect history', () => {
		const spectrum = scene();
		tracker.update(room(spectrum), spectrum, detect);
		const live: LiveState = {
			roomId: 'room',
			revision: 1,
			status: 'disconnected',
			count: 0,
			limit: 1000,
			tiktokAvailable: false,
			users: []
		};
		tracker.observeLive(live);
		tracker.observeLive({ ...live, status: 'connecting', platform: 'twitch' });
		tracker.observeLive({ ...live, status: 'connected', platform: 'twitch' });
		tracker.observeLive({ ...live, status: 'connected', platform: 'twitch' });
		tracker.observeLive({ ...live, roomId: 'other' });
		tracker.observeLive(live);
		expect(
			entries.filter((entry) => entry.kind === 'live').map((entry) => entry.liveConnected)
		).toEqual([true, false]);
		tracker.pause();
		tracker.update(room(spectrum), spectrum, detect);
		tracker.observeLive({ ...live, status: 'connected', platform: 'youtube' });
		expect(entries.filter((entry) => entry.kind === 'live')).toHaveLength(2);
	});

	it('records hand changes and current-room reactions without replaying initial hands', () => {
		const spectrum = scene();
		const raised = { ...b, handRaisedAt: 1000 };
		tracker.update(room(spectrum, [a, raised]), spectrum, detect);
		expect(entries.some((entry) => entry.kind === 'hand')).toBe(false);
		tracker.update(room(spectrum, [a, b]), spectrum, detect);
		tracker.update(room(spectrum, [a, raised]), spectrum, detect);
		tracker.update(room(spectrum, [a, raised]), spectrum, detect);
		expect(
			entries.filter((entry) => entry.kind === 'hand').map((entry) => entry.handRaised)
		).toEqual([false, true]);
		const reaction = { roomId: 'room', memberId: b.id, nickname: b.nickname, emoji: '👍' };
		tracker.reaction({ ...reaction, roomId: 'other' });
		tracker.reaction({ ...reaction, memberId: 'unknown' });
		tracker.reaction(reaction);
		expect(entries.filter((entry) => entry.kind === 'reaction')).toHaveLength(1);
		expect(entries.at(-1)).toMatchObject({ nickname: 'Bob', emoji: '👍' });
	});

	it('records initial entry and claim once, not roster polls or preexisting votes', () => {
		const spectrum = scene();
		spectrum.pellets[1].y = 100;
		tracker.update(room(spectrum), spectrum, detect);
		for (let i = 0; i < 5; i++) tracker.update(room({ ...spectrum }), { ...spectrum }, detect);
		vi.advanceTimersByTime(1000);
		expect(entries.map((entry) => entry.kind)).toEqual(['join', 'topic']);
		expect(entries[0].self).toBe(true);
		expect(entries[1].topic).toBe('First claim');
	});

	it('distinguishes real arrivals, promotions, nickname changes and departures', () => {
		const spectrum = scene();
		tracker.update(room(spectrum, [a]), spectrum, detect);
		const guest = { ...b, role: 'spectator' as const };
		tracker.update(room(spectrum, [a, guest]), spectrum, detect);
		tracker.update(room(spectrum, [a, b]), spectrum, detect);
		tracker.update(room(spectrum, [a, { ...b, nickname: 'Robert' }]), spectrum, detect);
		tracker.update(room(spectrum, [a]), spectrum, detect);
		expect(entries.map((entry) => entry.kind)).toEqual([
			'join',
			'topic',
			'join',
			'role',
			'nickname',
			'leave'
		]);
		expect(entries.at(-1)?.nickname).toBe('Robert');
	});

	it('waits for a stable cell and deduplicates moves within the same opinion', () => {
		let spectrum = scene();
		tracker.update(room(spectrum), spectrum, detect);
		for (const x of [500, 520, 630, 650]) {
			spectrum = {
				...spectrum,
				pellets: spectrum.pellets.map((pellet) =>
					pellet.memberId === 'm_b' ? { ...pellet, x, y: 100 } : pellet
				)
			};
			tracker.update(room(spectrum), spectrum, detect);
			vi.advanceTimersByTime(20);
		}
		vi.advanceTimersByTime(479);
		expect(opinions(entries)).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(opinions(entries)).toMatchObject([
			{ cellId: 'agree', nickname: 'Bob', topic: 'First claim' }
		]);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) =>
				pellet.memberId === 'm_b' ? { ...pellet, x: 700 } : pellet
			)
		};
		tracker.update(room(spectrum), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries)).toHaveLength(1);
	});

	it('does not reinterpret existing positions as new votes after a claim or layout change', () => {
		let spectrum = scene();
		tracker.update(room(spectrum), spectrum, detect);
		spectrum = { ...spectrum, topic: 'New claim', sliceCount: 3 };
		tracker.update(room(spectrum), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries)).toHaveLength(0);
		expect(entries.filter((entry) => entry.kind === 'topic').map((entry) => entry.topic)).toEqual([
			'First claim',
			'New claim'
		]);
		expect(entries.at(-1)?.kind).toBe('configuration');
	});

	it('cancels pending opinions and redacts cached positions when visibility is tightened', () => {
		let spectrum = scene();
		tracker.update(room(spectrum, [a, b], 'participant'), spectrum, detect);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) =>
				pellet.memberId === 'm_b' ? { ...pellet, x: 650, y: 100 } : pellet
			)
		};
		tracker.update(room(spectrum, [a, b], 'participant'), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries)).toHaveLength(1);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) =>
				pellet.memberId === 'm_b' ? { ...pellet, x: 500 } : pellet
			)
		};
		tracker.update(room(spectrum, [a, b], 'participant'), spectrum, detect);
		vi.advanceTimersByTime(250);
		spectrum = { ...spectrum, hidden: true };
		// Even a stale/unfiltered spectrum must not leak through the journal.
		tracker.update(room(spectrum, [a, b], 'participant'), spectrum, detect);
		vi.advanceTimersByTime(1000);
		expect(opinions(entries)).toHaveLength(0);
		expect(entries.at(-1)).toMatchObject({ kind: 'visibility', hidden: true });
	});

	it('does not retain admin-only opinions after demotion or reveal them retrospectively', () => {
		let spectrum = { ...scene(), hidden: true };
		tracker.update(room(spectrum), spectrum, detect);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) =>
				pellet.memberId === 'm_b' ? { ...pellet, x: 650, y: 100 } : pellet
			)
		};
		tracker.update(room(spectrum), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries)[0].privatePosition).toBe(true);
		tracker.update(room(spectrum, [a, b], 'spectator'), spectrum, detect);
		expect(opinions(entries)).toHaveLength(0);
		spectrum = { ...spectrum, hidden: false };
		tracker.update(room(spectrum, [a, b], 'spectator'), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries)).toHaveLength(0);
	});

	it('honors the separate spectator visibility setting', () => {
		let spectrum = scene();
		const hidden = () => {
			const state = room(spectrum, [a, b], 'spectator');
			state.settings.pelletsVisibleToSpectators = false;
			return state;
		};
		tracker.update(hidden(), spectrum, detect);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) => ({ ...pellet, x: 650, y: 100 }))
		};
		tracker.update(hidden(), spectrum, detect);
		vi.advanceTimersByTime(500);
		expect(opinions(entries).filter((entry) => entry.memberId === 'm_b')).toHaveLength(0);
	});

	it('cancels unfinished opinions on disconnect and avoids false rejoin events', () => {
		let spectrum = scene();
		tracker.update(room(spectrum), spectrum, detect);
		spectrum = {
			...spectrum,
			pellets: spectrum.pellets.map((pellet) =>
				pellet.memberId === 'm_b' ? { ...pellet, x: 650, y: 100 } : pellet
			)
		};
		tracker.update(room(spectrum), spectrum, detect);
		vi.advanceTimersByTime(200);
		tracker.pause();
		tracker.pause();
		tracker.update(room(spectrum), spectrum, detect);
		vi.advanceTimersByTime(1000);
		expect(entries.filter((entry) => entry.kind === 'join')).toHaveLength(1);
		expect(entries.filter((entry) => entry.kind === 'reconnected')).toHaveLength(1);
		expect(opinions(entries)).toHaveLength(0);
	});

	it('bounds history and clears it when switching rooms', () => {
		for (let index = 0; index < 230; index++) {
			const spectrum = scene(`Claim ${index}`);
			tracker.update(room(spectrum), spectrum, detect);
		}
		expect(entries).toHaveLength(ACTIVITY_HISTORY_LIMIT);
		expect(new Set(entries.map((entry) => entry.id)).size).toBe(ACTIVITY_HISTORY_LIMIT);
		const spectrum = scene('Other room');
		const other = { ...room(spectrum), roomId: 'other' };
		tracker.update(other, spectrum, detect);
		expect(entries.map((entry) => entry.kind)).toEqual(['join', 'topic']);
		expect(entries.some((entry) => entry.topic?.startsWith('Claim '))).toBe(false);
		tracker.clear();
		expect(entries).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});
});
