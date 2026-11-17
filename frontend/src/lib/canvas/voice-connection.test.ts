import { afterEach, expect, it, vi } from 'vitest';
import { VoiceConnection, type VoiceCredentials } from './voice-connection';

const fixture = vi.hoisted(() => ({
	mode: 'disconnect' as 'disconnect' | 'reject' | 'success',
	events: new Map<string, (...args: unknown[]) => void>(),
	setVolume: vi.fn(),
	createLocalAudioTrack: vi.fn(),
	publishTrack: vi.fn(),
	unpublishTrack: vi.fn()
}));

vi.mock('livekit-client', () => ({
	createLocalAudioTrack: fixture.createLocalAudioTrack,
	Track: { Source: { Microphone: 'microphone' } },
	RoomEvent: {
		ParticipantPermissionsChanged: 'permissions',
		Disconnected: 'disconnected',
		TrackSubscribed: 'subscribed',
		TrackUnsubscribed: 'unsubscribed',
		ActiveSpeakersChanged: 'speakers'
	},
	Room: class {
		state = 'connected';
		localParticipant = {
			publishTrack: fixture.publishTrack,
			unpublishTrack: fixture.unpublishTrack
		};
		remoteParticipants = new Map([['m_speaker', { setVolume: fixture.setVolume }]]);
		private disconnected?: () => void;
		on(event: string, callback: (...args: unknown[]) => void) {
			fixture.events.set(event, callback);
			if (event === 'disconnected') this.disconnected = callback;
			return this;
		}
		removeAllListeners() {
			fixture.events.clear();
			this.disconnected = undefined;
		}
		async connect() {
			if (fixture.mode === 'success') return;
			if (fixture.mode === 'disconnect') this.disconnected?.();
			throw new Error('ICE connection failed');
		}
		async disconnect() {}
		async startAudio() {}
	}
}));

const credentials: VoiceCredentials = {
	roomId: 'room',
	requestId: 'request',
	url: 'ws://localhost',
	token: 'fixture',
	canPublish: false,
	generation: 0
};

function setup() {
	const callbacks = {
		disconnected: vi.fn(),
		status: vi.fn(),
		microphone: vi.fn(),
		playbackBlocked: vi.fn(),
		remoteTracks: vi.fn(),
		speakers: vi.fn(),
		error: vi.fn(),
		localTrack: vi.fn()
	};
	return { callbacks, connection: new VoiceConnection({} as HTMLElement, callbacks) };
}

afterEach(() => {
	vi.unstubAllGlobals();
	fixture.mode = 'disconnect';
	fixture.events.clear();
	fixture.setVolume.mockClear();
	fixture.createLocalAudioTrack.mockReset();
	fixture.publishTrack.mockReset();
	fixture.unpublishTrack.mockReset();
});

it('reports an early SDK disconnect instead of swallowing the media failure', async () => {
	const { callbacks, connection } = setup();
	await connection.connect(credentials);
	expect(callbacks.status).toHaveBeenLastCalledWith('error');
	expect(callbacks.error).toHaveBeenCalledTimes(1);
	expect(callbacks.disconnected).not.toHaveBeenCalled();
});

it('requests rejoin only after an established SDK connection disconnects', async () => {
	fixture.mode = 'success';
	const { callbacks, connection } = setup();
	await connection.connect(credentials);
	fixture.events.get('disconnected')?.();
	await vi.waitFor(() => expect(callbacks.disconnected).toHaveBeenCalledOnce());
	await connection.disconnect();
	expect(callbacks.disconnected).toHaveBeenCalledOnce();
});

it('revokes only local capture without disconnecting the room', async () => {
	fixture.mode = 'success';
	const track = {
		mediaStreamTrack: Object.assign(new EventTarget(), { readyState: 'live' }),
		stop: vi.fn()
	};
	fixture.createLocalAudioTrack.mockResolvedValue(track);
	const { callbacks, connection } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	await connection.toggleMicrophone();
	await connection.setPublishAllowed(false);
	expect(track.stop).toHaveBeenCalled();
	expect(callbacks.microphone).toHaveBeenLastCalledWith(false, false);
	expect(callbacks.status).toHaveBeenLastCalledWith('connected');
	await connection.toggleMicrophone();
	expect(fixture.createLocalAudioTrack).toHaveBeenCalledTimes(1);
	await connection.setPublishAllowed(true);
	expect(fixture.createLocalAudioTrack).toHaveBeenCalledTimes(1);
	await connection.disconnect();
});

it('gives a local Firefox hint and allows a later connection', async () => {
	vi.stubGlobal('navigator', { userAgent: 'Firefox/145.0' });
	const { callbacks, connection } = setup();
	await connection.connect(credentials);
	expect(callbacks.error.mock.lastCall?.[0]).toContain('Chrome/Chromium');
	fixture.mode = 'success';
	await connection.connect(credentials);
	expect(callbacks.status).toHaveBeenLastCalledWith('connected');
});

it('also reports a connection rejection without a disconnect event', async () => {
	fixture.mode = 'reject';
	const { callbacks, connection } = setup();
	await connection.connect(credentials);
	expect(callbacks.status).toHaveBeenLastCalledWith('error');
});

it('applies listener-local volume to new tracks and keeps it across reconnects', async () => {
	fixture.mode = 'success';
	const { callbacks } = setup();
	const connection = new VoiceConnection({ append: vi.fn() } as unknown as HTMLElement, callbacks);
	connection.setVolume('m_speaker', 0.35);
	await connection.connect(credentials);
	const element = { dataset: {}, volume: 1, pause: vi.fn(), remove: vi.fn(), srcObject: {} };
	const track = { kind: 'audio', attach: () => element, detach: vi.fn() };
	fixture.events.get('subscribed')?.(
		track,
		{},
		{ identity: 'm_speaker', setVolume: fixture.setVolume }
	);
	expect(element.volume).toBe(0.35);
	connection.setVolume('m_speaker', 0);
	expect(element.volume).toBe(0);
	expect(fixture.setVolume).toHaveBeenLastCalledWith(0);
	connection.setVolume('m_speaker', Number.NaN);
	expect(connection.getVolume('m_speaker')).toBe(0);
	connection.setVolume('m_speaker', 20);
	expect(connection.getVolume('m_speaker')).toBe(1);
	await connection.connect(credentials);
	expect(connection.getVolume('m_speaker')).toBe(1);
	expect(element.pause).toHaveBeenCalled();
	expect(element.remove).toHaveBeenCalled();
});

it('reports active speaker public IDs and clears them when audio disconnects', async () => {
	fixture.mode = 'success';
	const { callbacks, connection } = setup();
	await connection.connect(credentials);
	fixture.events.get('speakers')?.([{ identity: 'm_speaker' }]);
	expect(callbacks.speakers).toHaveBeenLastCalledWith(['m_speaker']);
	await connection.disconnect();
	expect(callbacks.speakers).toHaveBeenLastCalledWith([]);
});

it('clears a permission error only after a later microphone publication succeeds', async () => {
	fixture.mode = 'success';
	const { callbacks, connection } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	fixture.createLocalAudioTrack.mockRejectedValueOnce(new Error('Permission denied'));
	await connection.toggleMicrophone();
	expect(callbacks.error.mock.lastCall?.[0]).not.toBe('');
	const mediaStreamTrack = Object.assign(new EventTarget(), { readyState: 'live' });
	fixture.createLocalAudioTrack.mockResolvedValue({ mediaStreamTrack, stop: vi.fn() });
	await connection.toggleMicrophone();
	expect(callbacks.microphone).toHaveBeenLastCalledWith(true, false);
	expect(callbacks.error).toHaveBeenLastCalledWith('');
	await connection.disconnect();
});

it.each([false, true])(
	'clears an externally ended microphone, including during publication (%s)',
	async (duringPublish) => {
		fixture.mode = 'success';
		const mediaStreamTrack = Object.assign(new EventTarget(), { readyState: 'live' });
		const track = { mediaStreamTrack, stop: vi.fn() };
		fixture.createLocalAudioTrack.mockResolvedValue(track);
		const end = () => {
			mediaStreamTrack.readyState = 'ended';
			mediaStreamTrack.dispatchEvent(new Event('ended'));
		};
		if (duringPublish) fixture.publishTrack.mockImplementation(async () => end());
		const { connection, callbacks } = setup();
		await connection.connect({ ...credentials, canPublish: true });
		await connection.toggleMicrophone();
		if (!duringPublish) {
			expect(callbacks.localTrack).toHaveBeenLastCalledWith(mediaStreamTrack);
			end();
		} else {
			expect(callbacks.localTrack).not.toHaveBeenCalledWith(mediaStreamTrack);
		}
		expect(callbacks.localTrack).toHaveBeenLastCalledWith(null);
		expect(callbacks.microphone).toHaveBeenLastCalledWith(false, false);
		expect(callbacks.status).toHaveBeenLastCalledWith('connected');
		await connection.disconnect();
	}
);

it('release cancels a pending permission prompt without publishing late capture', async () => {
	fixture.mode = 'success';
	const track = {
		mediaStreamTrack: Object.assign(new EventTarget(), { readyState: 'live' }),
		stop: vi.fn()
	};
	let finish!: (value: typeof track) => void;
	fixture.createLocalAudioTrack.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	const { connection, callbacks } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	const enabling = connection.toggleMicrophone();
	await vi.waitFor(() => expect(fixture.createLocalAudioTrack).toHaveBeenCalledOnce());
	await connection.disableMicrophone();
	finish(track);
	await enabling;
	expect(track.stop).toHaveBeenCalled();
	expect(fixture.publishTrack).not.toHaveBeenCalled();
	expect(callbacks.microphone).toHaveBeenLastCalledWith(false, false);
	await connection.disconnect();
});

it('an old delayed publication cannot reactivate or clear a newer held microphone', async () => {
	fixture.mode = 'success';
	const tracks = [0, 1].map(() => ({
		mediaStreamTrack: Object.assign(new EventTarget(), { readyState: 'live' }),
		stop: vi.fn()
	}));
	fixture.createLocalAudioTrack.mockResolvedValueOnce(tracks[0]).mockResolvedValueOnce(tracks[1]);
	let finish!: () => void;
	fixture.publishTrack
		.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		)
		.mockResolvedValueOnce(undefined);
	const { connection, callbacks } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	const first = connection.toggleMicrophone();
	await vi.waitFor(() => expect(fixture.publishTrack).toHaveBeenCalledOnce());
	await connection.disableMicrophone();
	await connection.toggleMicrophone();
	finish();
	await first;
	expect(tracks[0].stop).toHaveBeenCalled();
	expect(tracks[1].stop).not.toHaveBeenCalled();
	expect(callbacks.microphone).toHaveBeenLastCalledWith(true, false);
	expect(fixture.unpublishTrack).not.toHaveBeenCalledWith(tracks[1], true);
	await connection.disconnect();
});

it('permission revocation cancels pending capture even if permissions return before it resolves', async () => {
	fixture.mode = 'success';
	const track = {
		mediaStreamTrack: Object.assign(new EventTarget(), { readyState: 'live' }),
		stop: vi.fn()
	};
	let finish!: (value: typeof track) => void;
	fixture.createLocalAudioTrack.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	const { connection, callbacks } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	const enabling = connection.toggleMicrophone();
	await vi.waitFor(() => expect(fixture.createLocalAudioTrack).toHaveBeenCalledOnce());
	await connection.setPublishAllowed(false);
	await connection.setPublishAllowed(true);
	finish(track);
	await enabling;
	expect(track.stop).toHaveBeenCalled();
	expect(fixture.publishTrack).not.toHaveBeenCalled();
	expect(callbacks.microphone).toHaveBeenLastCalledWith(false, false);
	await connection.disconnect();
});

it('release prevents a delayed input-device switch from restarting capture', async () => {
	fixture.mode = 'success';
	const track = {
		mediaStreamTrack: Object.assign(new EventTarget(), { readyState: 'live' }),
		stop: vi.fn()
	};
	fixture.createLocalAudioTrack.mockResolvedValue(track);
	const { connection, callbacks } = setup();
	await connection.connect({ ...credentials, canPublish: true });
	await connection.toggleMicrophone();
	let finish!: () => void;
	fixture.unpublishTrack.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			})
	);
	const switching = connection.setMicrophoneDevice('another-device');
	await vi.waitFor(() => expect(fixture.unpublishTrack).toHaveBeenCalledOnce());
	await connection.disableMicrophone();
	finish();
	await switching;
	expect(fixture.createLocalAudioTrack).toHaveBeenCalledTimes(1);
	expect(callbacks.microphone).toHaveBeenLastCalledWith(false, false);
	await connection.disconnect();
});
