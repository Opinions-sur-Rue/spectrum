import { API_URL } from '$lib/env';
import type { EdgeModel, NoteModel } from './models';
import { applySpectrumMovement, mergeSpectrumSnapshot } from './spectrum-state';
import { appendChatMessage, mergeChatSnapshot, type ChatState, type ChatError } from './chat-state';
import type { VoiceCredentials, VoiceError } from './voice-connection';

export interface RoomMember {
	id: string;
	nickname: string;
	role: 'admin' | 'participant' | 'spectator';
	color?: string;
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
	};
	members: RoomMember[];
	spectrum: SpectrumState;
	voice?: { available: boolean; generation: number };
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
	private closedRoomId: string | null = null;

	constructor(
		private readonly userId: string,
		roomId: string,
		private readonly callbacks: Callbacks
	) {
		this.roomId = roomId;
	}

	connect(): void {
		if (this.disposed) return;
		this.callbacks.status('Connecting');
		const socket = new WebSocket(API_URL.replace(/^http/, 'ws') + '/spectrum/ws');
		this.socket = socket;
		socket.onopen = () => {
			socket.send(JSON.stringify({ procedure: 'signin', arguments: [this.userId] }));
		};
		socket.onmessage = (event) => {
			for (const line of String(event.data).split(/\r?\n/).filter(Boolean)) {
				let message;
				try {
					message = JSON.parse(line);
				} catch {
					this.callbacks.error('Invalid server message');
					continue;
				}
				if (message.procedure === 'ack' && message.arguments?.[0] === 'signin') {
					this.signedIn = true;
					this.callbacks.status('Connected');
					if (this.roomId) this.send('room.join', { roomId: this.roomId });
				} else if (message.procedure === 'stopped') {
					this.closedRoomId = this.roomId;
					this.roomId = '';
					this.chatRoomId = null;
					this.chatState = null;
					this.spectrumState = null;
					this.callbacks.roomClosed?.();
				} else if (message.v === 2) {
					const { op, payload } = message;
					if (!this.roomId && op !== 'room.state' && op !== 'error' && op !== 'pong') continue;
					if (op === 'room.state') {
						if (payload.roomId === this.closedRoomId) continue;
						if (this.spectrumState && payload.spectrum?.revision < this.spectrumState.revision) {
							// A newer topic/scene snapshot must not strand older role/chat settings.
							this.send('room.get');
							continue;
						}
						this.roomId = payload.roomId;
						this.spectrumRefreshPending = false;
						this.spectrumState = payload.spectrum
							? mergeSpectrumSnapshot(this.spectrumState, payload.spectrum)
							: null;
						this.callbacks.room({ ...payload, spectrum: this.spectrumState });
						if (this.chatRoomId !== payload.roomId) {
							this.chatState = null;
							this.chatRoomId = payload.roomId;
							this.send('chat.get');
						}
					} else if (op === 'chat.snapshot') {
						if (!this.chatRoomId || payload.roomId !== this.chatRoomId) continue;
						this.chatState = mergeChatSnapshot(this.chatState, payload);
						this.callbacks.chat?.(this.chatState);
					} else if (op === 'voice.credentials') {
						if (payload.roomId === this.roomId) this.callbacks.voice?.(payload);
					} else if (op === 'voice.invalidate') {
						this.callbacks.voiceInvalidated?.();
						this.send('room.get');
					} else if (op === 'chat.message') {
						if (!this.chatRoomId || payload.roomId !== this.chatRoomId) continue;
						this.chatState = appendChatMessage(this.chatState, payload);
						this.callbacks.chat?.(this.chatState);
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
		socket.onclose = () => {
			this.signedIn = false;
			this.spectrumState = null;
			this.spectrumRefreshPending = false;
			this.chatState = null;
			this.chatRoomId = null;
			if (this.disposed) return;
			this.callbacks.status('Reconnecting');
			this.callbacks.snapshot({ revision: 0, notes: [], edges: [] });
			this.retry = setTimeout(() => this.connect(), 2000);
		};
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
		this.socket?.close();
	}
}
