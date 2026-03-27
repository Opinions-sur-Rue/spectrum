/**
 * Room store — reactive state for the current Spectrum session.
 *
 * Centralises all room-level state so it can be shared between
 * the page component, the voice module, and future modules.
 */
import { newPellet } from '$lib/canvas/pellet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Participant {
	pellet: ReturnType<typeof newPellet> | null;
	target?: { x: number; y: number };
	nickname: string;
	microphone: boolean;
	volume: number;
	voiceId?: string;
	audio?: HTMLAudioElement;
	averageVoice?: number;
	validateOpinion?: ReturnType<typeof setTimeout>;
}

export interface Log {
	type: string;
	message: string;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const room = $state({
	/** The room ID (e.g. "OSR-ABCD"). Set when joining/creating. */
	spectrumId: undefined as string | undefined,

	/** Our color hex (used as userId in this app). */
	userId: undefined as string | undefined,

	/** Our display nickname. */
	nickname: undefined as string | undefined,

	/** True once signin RPC has been acknowledged. */
	initialized: false,

	/** True when we have admin privileges. */
	adminModeOn: false,

	/** The current claim/topic of the spectrum. */
	claim: '',

	/** Map of colorHex → Participant for everyone in the room. */
	others: {} as Record<string, Participant>,

	/** Chat/event history. */
	logs: [] as Log[],

	/** False when we have left the spectrum (stops RPC processing). */
	listening: true,

	/** Live stream channel type (youtube, twitch, tiktok). */
	liveChannel: undefined as string | undefined,

	/** True when a live stream is connected. */
	liveListening: false
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function joinRoom(spectrumId: string, userId: string, nickname: string, isAdmin: boolean) {
	room.spectrumId = spectrumId;
	room.userId = userId;
	room.nickname = nickname;
	room.adminModeOn = isAdmin;
	room.initialized = true;
	room.listening = true;
}

export function leaveRoom() {
	room.spectrumId = undefined;
	room.adminModeOn = false;
	room.listening = false;
	room.liveChannel = undefined;
	room.liveListening = false;
	// Clear all participants
	for (const key in room.others) {
		delete room.others[key];
	}
}

export function updateParticipant(colorHex: string, updates: Partial<Participant>) {
	if (room.others[colorHex]) {
		Object.assign(room.others[colorHex], updates);
	}
}

export function removeParticipant(colorHex: string) {
	delete room.others[colorHex];
}
