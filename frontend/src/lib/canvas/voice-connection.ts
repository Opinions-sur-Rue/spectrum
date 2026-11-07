import type { Room, LocalAudioTrack, RemoteTrack } from 'livekit-client';
import { m } from '$lib/paraglide/messages.js';

export interface VoiceCredentials {
	roomId: string;
	requestId: string;
	url: string;
	token: string;
	canPublish: boolean;
	generation: number;
}
export interface VoiceError {
	requestId?: string;
	message: string;
}
export type VoiceConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface Callbacks {
	status: (status: VoiceConnectionStatus) => void;
	microphone: (enabled: boolean, busy: boolean) => void;
	playbackBlocked: (blocked: boolean) => void;
	remoteTracks: (count: number) => void;
	error: (message: string) => void;
	speakers?: (identities: string[]) => void;
	localTrack?: (track: MediaStreamTrack | null) => void;
}

/** No SDK load or microphone access until an explicit user action. */
export class VoiceConnection {
	private room: Room | null = null;
	private microphone: LocalAudioTrack | null = null;
	private allowed = false;
	private operation = 0;
	private micBusy = false;
	private audio = new Map<RemoteTrack, HTMLMediaElement[]>();
	private volumes = new Map<string, number>();
	private audioOwners = new Map<RemoteTrack, string>();

	getVolume(memberId: string): number {
		return this.volumes.get(memberId) ?? 1;
	}

	/** Listener-local only. Never alters remote microphones or server permissions. */
	setVolume(memberId: string, volume: number): void {
		if (!Number.isFinite(volume)) return;
		const value = Math.min(1, Math.max(0, volume));
		this.volumes.set(memberId, value);
		this.room?.remoteParticipants.get(memberId)?.setVolume(value);
		for (const [track, elements] of this.audio) {
			if (this.audioOwners.get(track) === memberId)
				for (const element of elements) element.volume = value;
		}
	}

	constructor(
		private readonly container: HTMLElement,
		private readonly callbacks: Callbacks
	) {}

	async connect(credentials: VoiceCredentials): Promise<void> {
		const closing = this.disconnect();
		const operation = this.operation;
		await closing;
		if (operation !== this.operation) return;
		this.callbacks.status('connecting');
		try {
			const sdk = await import('livekit-client');
			if (operation !== this.operation) return;
			const room = new sdk.Room({ adaptiveStream: false, dynacast: false });
			let established = false;
			this.room = room;
			this.allowed = credentials.canPublish;
			room.on(sdk.RoomEvent.ActiveSpeakersChanged, (participants) => {
				if (this.room === room)
					this.callbacks.speakers?.(participants.map((participant) => participant.identity));
			});
			room.on(sdk.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
				if (this.room !== room || track.kind !== 'audio') return;
				const element = track.attach();
				element.dataset.voiceAudio = 'true';
				element.dataset.voiceMember = participant.identity;
				element.volume = this.getVolume(participant.identity);
				participant.setVolume(element.volume);
				this.audio.set(track, [element]);
				this.audioOwners.set(track, participant.identity);
				this.container.append(element);
				this.callbacks.remoteTracks(this.audio.size);
			});
			room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => {
				// The SDK may already have detached the element before this event.
				const attached = this.audio.get(track) ?? [];
				track.detach();
				for (const element of attached) {
					element.pause();
					element.srcObject = null;
					element.remove();
				}
				this.audio.delete(track);
				this.audioOwners.delete(track);
				if (this.room === room) this.callbacks.remoteTracks(this.audio.size);
			});
			room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, (playing) => {
				if (this.room === room) this.callbacks.playbackBlocked(!playing);
			});
			room.on(sdk.RoomEvent.Reconnecting, () => {
				if (this.room === room) {
					this.callbacks.status('reconnecting');
					this.callbacks.speakers?.([]);
				}
			});
			room.on(sdk.RoomEvent.Reconnected, () => {
				if (this.room === room) this.callbacks.status('connected');
			});
			room.on(sdk.RoomEvent.Disconnected, () => {
				if (this.room !== room) return;
				// The SDK can emit Disconnected before connect() rejects. Do not
				// silently reset to idle and swallow the failure as a stale operation.
				if (!established) void this.connectionFailed(operation);
				else void this.disconnect();
			});
			await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
			established = true;
			if (operation !== this.operation) {
				await room.disconnect();
				return;
			}
			this.callbacks.status('connected');
			this.callbacks.error('');
			this.callbacks.microphone(false, false);
			try {
				await room.startAudio();
			} catch {
				this.callbacks.playbackBlocked(true);
			}
		} catch {
			await this.connectionFailed(operation);
		}
	}

	private async connectionFailed(operation: number): Promise<void> {
		if (operation !== this.operation) return;
		const closing = this.disconnect();
		const failedOperation = this.operation;
		await closing;
		if (failedOperation !== this.operation) return;
		this.callbacks.status('error');
		const firefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
		this.callbacks.error(firefox ? m.v2_audio_firefox_failed() : m.v2_audio_connection_failed());
	}

	async enablePlayback(): Promise<void> {
		try {
			await this.room?.startAudio();
			this.callbacks.playbackBlocked(false);
		} catch {
			this.callbacks.error(m.v2_audio_playback_blocked());
		}
	}

	async toggleMicrophone(): Promise<void> {
		if (this.micBusy || !this.room || !this.allowed || this.room.state !== 'connected') return;
		const room = this.room;
		if (this.microphone) {
			const track = this.microphone;
			this.stopCapture();
			try {
				await room.localParticipant.unpublishTrack(track, true);
			} catch {
				/* Capture is already stopped. */
			}
			return;
		}
		const operation = this.operation;
		this.micBusy = true;
		this.callbacks.microphone(false, true);
		let track: LocalAudioTrack | null = null;
		try {
			const sdk = await import('livekit-client');
			if (operation !== this.operation || !this.allowed) return;
			// This is the only getUserMedia path, called only from the mic button.
			track = await sdk.createLocalAudioTrack({
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true
			});
			if (operation !== this.operation || this.room !== room || !this.allowed) {
				track.stop();
				return;
			}
			this.microphone = track;
			track.mediaStreamTrack.addEventListener(
				'ended',
				() => {
					if (this.microphone === track) this.stopCapture();
				},
				{ once: true }
			);
			await room.localParticipant.publishTrack(track, { source: sdk.Track.Source.Microphone });
			if (operation !== this.operation || this.room !== room || !this.allowed) {
				track.stop();
				return;
			}
			if (this.microphone !== track || track.mediaStreamTrack.readyState !== 'live') {
				if (this.microphone === track) this.stopCapture();
				return;
			}
			this.callbacks.microphone(true, false);
			this.callbacks.error('');
			this.callbacks.localTrack?.(track.mediaStreamTrack);
		} catch {
			track?.stop();
			if (operation === this.operation) {
				this.microphone = null;
				this.callbacks.error(m.v2_microphone_failed());
			}
		} finally {
			if (operation === this.operation) {
				this.micBusy = false;
				this.callbacks.microphone(this.microphone !== null, false);
			}
		}
	}

	private stopCapture(): void {
		this.callbacks.localTrack?.(null);
		this.microphone?.stop();
		this.microphone = null;
		this.micBusy = false;
		this.callbacks.microphone(false, false);
	}

	async disconnect(): Promise<void> {
		this.operation++;
		this.allowed = false;
		this.stopCapture();
		const room = this.room;
		this.room = null;
		room?.removeAllListeners();
		for (const element of [...this.audio.values()].flat()) {
			element.pause();
			element.srcObject = null;
			element.remove();
		}
		this.audio.clear();
		this.audioOwners.clear();
		this.callbacks.speakers?.([]);
		this.callbacks.remoteTracks(0);
		this.callbacks.playbackBlocked(false);
		this.callbacks.status('idle');
		if (room) {
			try {
				await room.disconnect(true);
			} catch {
				/* Local media is already stopped. */
			}
		}
	}
}
