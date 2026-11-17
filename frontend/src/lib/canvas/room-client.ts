import { API_URL } from '$lib/env';
import type { EdgeModel, NoteModel } from './models';
import { applySpectrumMovement, mergeSpectrumSnapshot } from './spectrum-state';
import {
	appendChatMessage,
	markChatRemoved,
	mergeChatSnapshot,
	type ChatState,
	type ChatError
} from './chat-state';
import type { VoiceCredentials, VoiceError } from './voice-connection';
import { mergeTranscript, type TranscriptState } from './transcript-state';
import type { BrowserTranscriptSession, BrowserTranscriptFailure } from './browser-stt';

export interface RoomMember {
	id: string;
	nickname: string;
	role: 'admin' | 'participant' | 'spectator';
	color?: string;
	handRaisedAt?: number;
	microphoneMuted?: boolean;
	speakingSeconds?: number;
}

/** Server-accumulated speaking totals, updated when a turn ends. */
export interface SpeakingTimeUpdate {
	roomId: string;
	memberId: string;
	speakingSeconds: number;
}

export interface ReactionEvent {
	roomId: string;
	memberId: string;
	nickname: string;
	emoji: string;
}

export interface LiveState {
	revision: number;
	roomId: string;
	platform?: string;
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
	count: number;
	limit: number;
	tiktokAvailable: boolean;
	users: { id: string; nickname: string; vote: number | null; selected: boolean }[];
}

export interface RoomState {
	roomId: string;
	userId: string;
	role: 'admin' | 'participant' | 'spectator';
	settings: {
		notesVisibleToSpectators: boolean;
		pelletsVisibleToSpectators: boolean;
		participantSlots: number;
		spectatorLimit: number;
		spectatorChatEnabled: boolean;
		transcriptionEnabled?: boolean;
		transcriptionLanguage?: 'fr' | 'en' | 'auto';
	};
	members: RoomMember[];
	spectrum: SpectrumState;
	voice?: { available: boolean; generation: number };
	timer?: RoomTimerState;
	transcription?: {
		available: boolean;
		ready: boolean;
		mode?: 'server' | 'browser';
		speakers?: string[];
	};
}

export interface RoomTimerState {
	revision: number;
	durationSeconds: number;
	endsAt: number;
	serverNow: number;
}

export interface Pellet {
	memberId: string;
	nickname: string;
	color: string;
	x: number;
	y: number;
	version: number;
}

export interface SpectrumState {
	revision: number;
	topic: string;
	sliceCount: number;
	showNeutralCircle?: boolean;
	hidden: boolean;
	pellets: Pellet[];
}

export interface SpectrumMovement {
	revision: number;
	memberId: string;
	x: number;
	y: number;
	version: number;
}

export interface CanvasSnapshot {
	revision: number;
	notes: NoteModel[] | null;
	edges: EdgeModel[] | null;
}

interface Callbacks {
	status: (status: string) => void;
	room: (room: RoomState) => void;
	snapshot: (snapshot: CanvasSnapshot) => void;
	error: (message: string) => void;
	spectrum?: (spectrum: SpectrumState) => void;
	chat?: (chat: ChatState) => void;
	chatError?: (error: ChatError) => void;
	roomClosed?: () => void;
	voice?: (credentials: VoiceCredentials) => void;
	voiceError?: (error: VoiceError) => void;
	voiceInvalidated?: () => void;
	speakingTime?: (update: SpeakingTimeUpdate) => void;
	transcript?: (transcript: TranscriptState) => void;
	reaction?: (reaction: ReactionEvent) => void;
	live?: (state: LiveState) => void;
	browserTranscript?: (session: BrowserTranscriptSession) => void;
	browserTranscriptError?: (failure: BrowserTranscriptFailure) => void;
}

/** Isolated v2 connection: never installs handlers in the v1 global dispatcher. */
export class RoomClient {
	private socket: WebSocket | null = null;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private signedIn = false;
	private roomId: string;
	private spectrumState: SpectrumState | null = null;
	private spectrumRefreshPending = false;
	private chatState: ChatState | null = null;
	private chatRoomId: string | null = null;
	private transcriptState: TranscriptState | null = null;
	private closedRoomId: string | null = null;
	private liveRevision = -1;
	private role: RoomState['role'] | null = null;
	private admittedRoom = false;
	private liveState: LiveState | null = null;
	private deadline: ReturnType<typeof setTimeout> | undefined;
	private resumeProbe = 0;
	private probeSequence = 0;
	private listening = false;
	private readonly onVisibility = () => {
		if (document.visibilityState === 'visible') this.resume();
	};
	private readonly onResume = () => this.resume();

	constructor(
		private readonly userId: string,
		roomId: string,
		private readonly callbacks: Callbacks
	) {
		this.roomId = roomId;
	}

	connect(): void {
		if (this.disposed) return;
		if (this.socket && this.socket.readyState < 2) return;
		if (this.socket) this.disconnected(this.socket);
		clearTimeout(this.retry);
		if (!this.listening && typeof window !== 'undefined') {
			this.listening = true;
			document.addEventListener('visibilitychange', this.onVisibility);
			window.addEventListener('pageshow', this.onResume);
			window.addEventListener('online', this.onResume);
		}
		this.callbacks.status('Connecting');
		const socket = new WebSocket(API_URL.replace(/^http/, 'ws') + '/spectrum/ws');
		this.socket = socket;
		this.deadline = setTimeout(() => this.restart(socket), 10000);
		socket.onopen = () => {
			if (this.disposed || this.socket !== socket) return;
			socket.send(JSON.stringify({ procedure: 'signin', arguments: [this.userId] }));
		};
		socket.onmessage = (event) => {
			if (this.disposed || this.socket !== socket) return;
			for (const line of String(event.data).split(/\r?\n/).filter(Boolean)) {
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					this.callbacks.error('Invalid server message');
					continue;
				}
				if (message.procedure === 'ack' && message.arguments?.[0] === 'signin') {
					clearTimeout(this.deadline);
					this.signedIn = true;
					this.callbacks.status('Connected');
					if (this.roomId) this.send('room.join', { roomId: this.roomId });
				} else if (
					message.procedure === 'stopped' ||
					(message.v === 2 &&
						message.op === 'room.closed' &&
						message.payload?.roomId === this.roomId)
				) {
					this.closedRoomId = this.roomId;
					this.admittedRoom = false;
					this.roomId = '';
					this.chatRoomId = null;
					this.chatState = null;
					this.transcriptState = null;
					this.spectrumState = null;
					this.liveRevision = -1;
					this.role = null;
					this.liveState = null;
					this.callbacks.roomClosed?.();
				} else if (message.v === 2) {
					const { op, payload } = message;
					if (op === 'pong' && this.resumeProbe && payload?.echo?.resume === this.resumeProbe) {
						clearTimeout(this.deadline);
						this.resumeProbe = 0;
						if (this.admittedRoom && this.roomId) this.send('room.get');
						continue;
					}
					if (!this.roomId && op !== 'room.state' && op !== 'error' && op !== 'pong') continue;
					if (op === 'room.state') {
						if (payload.roomId === this.closedRoomId) continue;
						if (this.spectrumState && payload.spectrum?.revision < this.spectrumState.revision) {
							// A newer topic/scene snapshot must not strand older role/chat settings.
							this.send('room.get');
							continue;
						}
						const previousRole = this.role;
						this.roomId = payload.roomId;
						this.admittedRoom = true;
						this.role = payload.role ?? null;
						if (this.role !== 'admin' && this.liveState) {
							this.liveState = { ...this.liveState, users: [] };
							this.callbacks.live?.(this.liveState);
						}
						this.spectrumRefreshPending = false;
						this.spectrumState = payload.spectrum
							? mergeSpectrumSnapshot(this.spectrumState, payload.spectrum)
							: null;
						this.callbacks.room({ ...payload, spectrum: this.spectrumState });
						const chatRoomChanged = this.chatRoomId !== payload.roomId;
						// A role change moves the member into or out of the stage and admin
						// audiences: drop the cached history instead of merging it, so a
						// demoted member cannot keep reading stage messages and a promoted
						// one does receive the earlier ones.
						const audienceChanged = previousRole !== null && previousRole !== this.role;
						if (chatRoomChanged || audienceChanged) {
							this.chatState = null;
							if (chatRoomChanged) this.transcriptState = null;
							this.chatRoomId = payload.roomId;
							this.send('chat.get');
							if (chatRoomChanged) this.send('transcript.get');
						}
					} else if (op === 'transcript.started') {
						if (payload.roomId === this.roomId) this.callbacks.browserTranscript?.(payload);
					} else if (op === 'room.reaction') {
						if (payload.roomId === this.roomId) this.callbacks.reaction?.(payload);
					} else if (op === 'live.snapshot') {
						if (payload.roomId !== this.roomId) continue;
						if (
							payload.revision < this.liveRevision ||
							payload.revision < (this.spectrumState?.revision ?? 0)
						) {
							this.send('live.get');
							continue;
						}
						this.liveRevision = payload.revision;
						const live: LiveState = {
							...payload,
							users: this.role === 'admin' ? payload.users : []
						};
						this.liveState = live;
						this.callbacks.live?.(live);
					} else if (op === 'live.invalidate') {
						this.send('live.get');
					} else if (op === 'transcript.snapshot' || op === 'transcript.segment') {
						if (payload.roomId !== this.roomId) continue;
						this.transcriptState = mergeTranscript(
							this.transcriptState,
							op === 'transcript.snapshot'
								? payload
								: { sequence: payload.sequence, segments: [payload] }
						);
						this.callbacks.transcript?.(this.transcriptState);
					} else if (op === 'chat.snapshot') {
						if (!this.chatRoomId || payload.roomId !== this.chatRoomId) continue;
						this.chatState = mergeChatSnapshot(this.chatState, payload);
						this.callbacks.chat?.(this.chatState);
					} else if (op === 'voice.credentials') {
						if (payload.roomId === this.roomId) this.callbacks.voice?.(payload);
					} else if (op === 'voice.invalidate') {
						this.callbacks.voiceInvalidated?.();
						this.send('room.get');
					} else if (op === 'voice.speaking') {
						if (payload.roomId === this.roomId) this.callbacks.speakingTime?.(payload);
					} else if (op === 'chat.message') {
						if (!this.chatRoomId || payload.roomId !== this.chatRoomId) continue;
						this.chatState = appendChatMessage(this.chatState, payload);
						this.callbacks.chat?.(this.chatState);
					} else if (op === 'chat.removed') {
						if (!this.chatRoomId || payload.roomId !== this.chatRoomId) continue;
						// Moderation masks content in place rather than deleting the entry.
						if (this.chatState) {
							const next = markChatRemoved(this.chatState, payload.messageId);
							if (next !== this.chatState) {
								this.chatState = next;
								this.callbacks.chat?.(next);
							}
						}
					} else if (op === 'canvas.snapshot') {
						this.callbacks.snapshot(payload);
					} else if (op === 'room.invalidate') {
						this.send('room.get');
					} else if (op === 'spectrum.snapshot') {
						this.spectrumRefreshPending = false;
						const next = mergeSpectrumSnapshot(this.spectrumState, payload);
						if (next !== this.spectrumState) {
							this.spectrumState = next;
							this.callbacks.spectrum?.(next);
						}
					} else if (op === 'spectrum.invalidate') {
						this.refreshSpectrum();
					} else if (op === 'spectrum.moved') {
						if (!this.spectrumState || payload.revision > this.spectrumState.revision) {
							this.refreshSpectrum();
							continue;
						}
						const next = applySpectrumMovement(this.spectrumState, payload);
						if (next !== this.spectrumState) {
							this.spectrumState = next;
							this.callbacks.spectrum?.(next);
						}
					} else if (op === 'error') {
						// Requests already queued during leave/revocation can finish
						// after room.closed. Do not show their stale membership errors.
						if (!this.roomId && payload.code === 'not_in_room') continue;
						if (payload.code === 'room_join_failed' || payload.code === 'room_create_failed') {
							if (!this.role) {
								// A formerly admitted room may have disappeared while offline.
								// Return to the lobby instead of stranding disabled room controls.
								if (this.admittedRoom) {
									this.admittedRoom = false;
									this.closedRoomId = this.roomId;
									this.transcriptState = null;
									this.callbacks.roomClosed?.();
									this.chatState = null;
									this.chatRoomId = null;
								}
								this.roomId = '';
							}
							this.callbacks.error(payload.message);
							// There is no canvas to refresh after a failed admission. Those
							// requests would replace the useful error with not_in_room.
							continue;
						}
						if (payload.code?.startsWith('browser_transcript_')) {
							this.callbacks.browserTranscriptError?.({
								requestId: payload.requestId,
								message: payload.message
							});
							continue;
						}
						if (payload.code?.startsWith('voice_')) {
							if (this.callbacks.voiceError)
								this.callbacks.voiceError({
									requestId: payload.requestId,
									message: payload.message
								});
							else this.callbacks.error(payload.message);
							continue;
						}
						if (payload.code?.startsWith('chat_')) {
							if (this.callbacks.chatError)
								this.callbacks.chatError({
									requestId: payload.requestId,
									message: payload.message
								});
							else this.callbacks.error(payload.message);
							continue;
						}
						this.callbacks.error(payload.message);
						// Restore authoritative positions after a rejected move/edit.
						if (this.roomId && payload.code !== 'not_in_room') {
							this.send('spectrum.get');
							this.send('canvas.get');
						}
					} else if (
						op === 'canvas.invalidate' ||
						op.startsWith('note.') ||
						op.startsWith('edge.')
					) {
						// Snapshots replace state, including removed notes and incident edges.
						this.send('canvas.get');
					}
				}
			}
		};
		socket.onclose = () => this.disconnected(socket);
	}

	private disconnected(socket: WebSocket): void {
		if (this.socket !== socket) return;
		clearTimeout(this.deadline);
		this.resumeProbe = 0;
		this.socket = null;
		this.signedIn = false;
		this.spectrumState = null;
		this.spectrumRefreshPending = false;
		this.liveRevision = -1;
		this.liveState = null;
		this.role = null;
		this.chatState = null;
		this.chatRoomId = null;
		if (this.disposed) return;
		this.callbacks.status('Reconnecting');
		this.callbacks.snapshot({ revision: 0, notes: [], edges: [] });
		this.retry = setTimeout(() => this.connect(), 2000);
	}

	/** Browser suspension can leave a dead transport reporting OPEN indefinitely. */
	private resume(): void {
		if (this.disposed || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
			return;
		if (!this.socket || this.socket.readyState >= 2) {
			this.connect();
			return;
		}
		if (!this.signedIn || this.resumeProbe) return;
		const socket = this.socket;
		this.resumeProbe = ++this.probeSequence;
		this.deadline = setTimeout(() => this.restart(socket), 5000);
		this.send('ping', { resume: this.resumeProbe });
	}

	private restart(socket: WebSocket): void {
		if (this.disposed || this.socket !== socket) return;
		// Retire callbacks immediately: close events can arrive after a new signin.
		this.disconnected(socket);
		socket.close();
		clearTimeout(this.retry);
		this.connect();
	}

	private refreshSpectrum(): void {
		if (!this.spectrumRefreshPending) this.spectrumRefreshPending = this.send('spectrum.get');
	}

	send(op: string, payload: unknown = {}): boolean {
		if (!this.signedIn || this.socket?.readyState !== WebSocket.OPEN) return false;
		if (op === 'room.create' || op === 'room.join') this.closedRoomId = null;
		this.socket.send(JSON.stringify({ v: 2, op, payload }));
		return true;
	}

	destroy(): void {
		this.disposed = true;
		clearTimeout(this.retry);
		clearTimeout(this.deadline);
		if (this.listening) {
			document.removeEventListener('visibilitychange', this.onVisibility);
			window.removeEventListener('pageshow', this.onResume);
			window.removeEventListener('online', this.onResume);
		}
		this.socket?.close();
	}
}
