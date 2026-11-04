import type { Room, LocalAudioTrack, RemoteTrack } from 'livekit-client';

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
}

/** No SDK load or microphone access until an explicit user action. */
export class VoiceConnection {
	private room: Room | null = null;
	private microphone: LocalAudioTrack | null = null;
	private allowed = false;
	private operation = 0;
	private micBusy = false;
	private audio = new Map<RemoteTrack, HTMLMediaElement[]>();

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
			this.room = room;
			this.allowed = credentials.canPublish;
			room.on(sdk.RoomEvent.TrackSubscribed, (track) => {
				if (this.room !== room || track.kind !== 'audio') return;
				const element = track.attach();
				element.dataset.voiceAudio = 'true';
				this.audio.set(track, [element]);
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
				if (this.room === room) this.callbacks.remoteTracks(this.audio.size);
			});
			room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, (playing) => {
				if (this.room === room) this.callbacks.playbackBlocked(!playing);
			});
			room.on(sdk.RoomEvent.Reconnecting, () => {
				if (this.room === room) this.callbacks.status('reconnecting');
			});
			room.on(sdk.RoomEvent.Reconnected, () => {
				if (this.room === room) this.callbacks.status('connected');
			});
			room.on(sdk.RoomEvent.Disconnected, () => {
				if (this.room !== room) return;
				void this.disconnect();
			});
			await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
			if (operation !== this.operation) {
				await room.disconnect();
				return;
			}
			this.callbacks.status('connected');
			this.callbacks.microphone(false, false);
			try {
				await room.startAudio();
			} catch {
				this.callbacks.playbackBlocked(true);
			}
		} catch {
			if (operation !== this.operation) return;
			const closing = this.disconnect();
			const failedOperation = this.operation;
			await closing;
			if (failedOperation !== this.operation) return;
			this.callbacks.status('error');
			this.callbacks.error('Could not connect to the local voice service.');
		}
	}

	async enablePlayback(): Promise<void> {
		try {
			await this.room?.startAudio();
			this.callbacks.playbackBlocked(false);
		} catch {
			this.callbacks.error('Your browser blocked audio playback. Try again.');
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
			await room.localParticipant.publishTrack(track, { source: sdk.Track.Source.Microphone });
			if (operation !== this.operation || this.room !== room || !this.allowed) {
				track.stop();
				return;
			}
			this.callbacks.microphone(true, false);
		} catch {
			track?.stop();
			if (operation === this.operation) {
				this.microphone = null;
				this.callbacks.error('Microphone unavailable or permission denied.');
			}
		} finally {
			if (operation === this.operation) {
				this.micBusy = false;
				this.callbacks.microphone(this.microphone !== null, false);
			}
		}
	}

	private stopCapture(): void {
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
