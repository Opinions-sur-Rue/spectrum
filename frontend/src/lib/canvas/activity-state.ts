import type { RoomMember, RoomState, SpectrumState, ReactionEvent, LiveState } from './room-client';
import type { SpectrumCellID } from './cells';

export const ACTIVITY_HISTORY_LIMIT = 200;
export type ActivityKind =
	| 'join'
	| 'leave'
	| 'role'
	| 'nickname'
	| 'topic'
	| 'opinion'
	| 'visibility'
	| 'configuration'
	| 'hand'
	| 'reaction'
	| 'live'
	| 'reconnected';
export interface ActivityEntry {
	id: number;
	at: number;
	kind: ActivityKind;
	memberId?: string;
	nickname?: string;
	color?: string;
	self?: boolean;
	previousNickname?: string;
	role?: RoomMember['role'];
	topic?: string;
	cellId?: SpectrumCellID;
	sliceCount?: number;
	showNeutralCircle?: boolean;
	hidden?: boolean;
	privatePosition?: boolean;
	spectatorPositionHidden?: boolean;
	handRaised?: boolean;
	emoji?: string;
	platform?: string;
	liveConnected?: boolean;
}
type DetectCell = (x: number, y: number) => { id: SpectrumCellID } | null;
type Point = { x: number; y: number };

/** Like v1, this is a bounded, tab-local journal of events actually observed.
 * It never fetches hidden coordinates, persists room data, or replays inferred
 * historical votes when a member joins or visibility/layout changes. */
export class ActivityTracker {
	private entries: ActivityEntry[] = [];
	private sequence = 0;
	private roomId: string | null = null;
	private selfId = '';
	private members = new Map<string, RoomMember>();
	private points = new Map<string, Point>();
	private cells = new Map<string, SpectrumCellID | null>();
	private pending = new Map<string, ReturnType<typeof setTimeout>>();
	private spectrum: SpectrumState | null = null;
	private room: RoomState | null = null;
	private policy = '';
	private geometry: DetectCell | null = null;
	private interrupted = false;
	private livePlatform: string | null | undefined;

	constructor(
		private publish: (entries: ActivityEntry[]) => void,
		private now = Date.now,
		private settleMs = 500
	) {}

	update(room: RoomState | null, spectrum: SpectrumState | null, detect: DetectCell | null): void {
		if (!room || !spectrum) {
			this.pause();
			return;
		}
		const first = this.roomId !== room.roomId;
		if (first) {
			this.clear();
			this.roomId = room.roomId;
			this.selfId = room.userId;
		}
		const previousSpectrum = this.spectrum;
		this.room = room;
		this.spectrum = spectrum;
		this.observeMembers(room, first);
		if (this.interrupted) {
			this.append({ kind: 'reconnected' });
			this.interrupted = false;
			this.resetPositions();
		}
		const newTopic = previousSpectrum && previousSpectrum.topic !== spectrum.topic;
		if ((first && spectrum.topic) || newTopic) {
			this.cancelPending();
			this.cells.clear();
			this.append({ kind: 'topic', topic: spectrum.topic });
		}
		if (previousSpectrum && previousSpectrum.hidden !== spectrum.hidden)
			this.append({ kind: 'visibility', hidden: spectrum.hidden });
		if (
			previousSpectrum &&
			(previousSpectrum.sliceCount !== spectrum.sliceCount ||
				(previousSpectrum.showNeutralCircle ?? true) !== (spectrum.showNeutralCircle ?? true))
		)
			this.append({
				kind: 'configuration',
				sliceCount: spectrum.sliceCount,
				showNeutralCircle: spectrum.showNeutralCircle ?? true
			});

		const policy = `${room.role}:${spectrum.hidden}:${room.settings.pelletsVisibleToSpectators}:${spectrum.sliceCount}:${spectrum.showNeutralCircle ?? true}`;
		if (this.policy !== policy || this.geometry !== detect) this.resetPositions();
		this.policy = policy;
		this.geometry = detect;
		this.prunePrivateOpinions();
		if (detect) this.observePositions(spectrum, detect);
	}

	reaction(event: ReactionEvent): void {
		if (event.roomId !== this.roomId || this.interrupted) return;
		const member = this.members.get(event.memberId);
		if (member) this.memberEvent('reaction', member, { emoji: event.emoji });
	}

	observeLive(live: LiveState | null): void {
		if (!live || live.roomId !== this.roomId || this.interrupted) return;
		const platform = live.status === 'connected' ? (live.platform ?? null) : null;
		if (this.livePlatform !== undefined && this.livePlatform !== platform) {
			if (this.livePlatform)
				this.append({ kind: 'live', platform: this.livePlatform, liveConnected: false });
			if (platform) this.append({ kind: 'live', platform, liveConnected: true });
		}
		this.livePlatform = platform;
	}

	private observeMembers(room: RoomState, first: boolean) {
		const next = new Map(room.members.map((member) => [member.id, { ...member }]));
		if (first) {
			const own = next.get(room.userId);
			if (own) this.memberEvent('join', own);
		} else {
			for (const member of next.values()) {
				const previous = this.members.get(member.id);
				if (!previous) this.memberEvent('join', member);
				else {
					if (previous.nickname !== member.nickname)
						this.memberEvent('nickname', member, { previousNickname: previous.nickname });
					if (previous.role !== member.role)
						this.memberEvent('role', member, { role: member.role });
					if (!!previous.handRaisedAt !== !!member.handRaisedAt)
						this.memberEvent('hand', member, { handRaised: !!member.handRaisedAt });
				}
			}
			for (const member of this.members.values()) {
				if (!next.has(member.id)) {
					this.memberEvent('leave', member);
					this.cancelMember(member.id);
					this.points.delete(member.id);
					this.cells.delete(member.id);
				}
			}
		}
		this.members = next;
	}

	private observePositions(spectrum: SpectrumState, detect: DetectCell) {
		const pellets = spectrum.pellets.filter((pellet) => {
			const member = this.members.get(pellet.memberId);
			return member && member.role !== 'spectator' && this.canSeePosition(pellet.memberId);
		});
		const visible = new Set(pellets.map((pellet) => pellet.memberId));
		for (const id of this.points.keys()) {
			if (!visible.has(id)) {
				this.cancelMember(id);
				this.points.delete(id);
				this.cells.delete(id);
			}
		}
		for (const pellet of pellets) {
			const previous = this.points.get(pellet.memberId);
			if (previous && previous.x === pellet.x && previous.y === pellet.y) continue;
			this.cancelMember(pellet.memberId);
			this.points.set(pellet.memberId, { x: pellet.x, y: pellet.y });
			const cell = detect(pellet.x, pellet.y)?.id ?? null;
			if (!previous || !cell || cell === 'notReplied') {
				this.cells.set(pellet.memberId, cell);
				continue;
			}
			const memberId = pellet.memberId;
			this.pending.set(
				memberId,
				setTimeout(() => this.settled(memberId, cell), this.settleMs)
			);
		}
	}

	private settled(memberId: string, cell: SpectrumCellID) {
		this.pending.delete(memberId);
		const member = this.members.get(memberId);
		if (
			!member ||
			member.role === 'spectator' ||
			!this.room ||
			!this.spectrum ||
			this.cells.get(memberId) === cell ||
			!this.canSeePosition(memberId)
		)
			return;
		if (!this.spectrum.pellets.some((pellet) => pellet.memberId === memberId)) return;
		this.cells.set(memberId, cell);
		this.memberEvent('opinion', member, {
			cellId: cell,
			topic: this.spectrum.topic,
			privatePosition: this.spectrum.hidden,
			spectatorPositionHidden: !this.room.settings.pelletsVisibleToSpectators
		});
	}

	private prunePrivateOpinions() {
		if (!this.room || !this.spectrum || this.room.role === 'admin') return;
		const room = this.room,
			spectrum = this.spectrum;
		const next = this.entries.filter(
			(entry) =>
				entry.kind !== 'opinion' ||
				entry.memberId === this.selfId ||
				(!entry.privatePosition &&
					!spectrum.hidden &&
					(room.role !== 'spectator' ||
						(!entry.spectatorPositionHidden && room.settings.pelletsVisibleToSpectators)))
		);
		if (next.length !== this.entries.length) {
			this.entries = next;
			this.publish([...next]);
		}
	}

	private canSeePosition(memberId: string) {
		return (
			!!this.room &&
			!!this.spectrum &&
			(this.room.role === 'admin' ||
				memberId === this.selfId ||
				(!this.spectrum.hidden &&
					(this.room.role !== 'spectator' || this.room.settings.pelletsVisibleToSpectators)))
		);
	}

	private memberEvent(kind: ActivityKind, member: RoomMember, extra: Partial<ActivityEntry> = {}) {
		this.append({
			kind,
			memberId: member.id,
			nickname: member.nickname,
			color: member.color,
			self: member.id === this.selfId,
			...extra
		});
	}

	private append(event: Omit<ActivityEntry, 'id' | 'at'>) {
		this.entries = [...this.entries, { ...event, id: ++this.sequence, at: this.now() }].slice(
			-ACTIVITY_HISTORY_LIMIT
		);
		this.publish([...this.entries]);
	}

	private cancelMember(id: string) {
		clearTimeout(this.pending.get(id));
		this.pending.delete(id);
	}
	private cancelPending() {
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}
	private resetPositions() {
		this.cancelPending();
		this.points.clear();
		this.cells.clear();
	}

	pause() {
		this.cancelPending();
		this.livePlatform = undefined;
		if (this.roomId) this.interrupted = true;
	}
	clear() {
		this.resetPositions();
		this.entries = [];
		this.sequence = 0;
		this.roomId = null;
		this.selfId = '';
		this.members.clear();
		this.room = null;
		this.spectrum = null;
		this.geometry = null;
		this.policy = '';
		this.interrupted = false;
		this.livePlatform = undefined;
		this.publish([]);
	}
	destroy() {
		this.clear();
	}
}
