/**
 * Voice module — PeerJS WebRTC audio management.
 *
 * Manages peer connections, microphone input (with gain control),
 * and audio playback from remote participants.
 */
import Peer from 'peerjs';
import { SvelteMap } from 'svelte/reactivity';

// ---------------------------------------------------------------------------
// Reactive state (exported so the page can bind to them in templates)
// ---------------------------------------------------------------------------

/** Reactive voice state. Use voiceState.peerId etc. in templates. */
export const voiceState = $state({
	peerId: undefined as string | undefined,
	peerConnected: false,
	microphone: false,
	averageVoice: 0
});

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let peer: Peer | undefined;
let localStream: MediaStream | undefined;
let silentStream: MediaStream | undefined;
const connections = new SvelteMap<string, MediaStream>();
const voiceIdToUserId = new SvelteMap<string, string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal map, not reactive state
const activeCalls = new Map<string, ReturnType<Peer['call']>>();

const getAudioContext = () =>
	new (
		window.AudioContext ||
		(window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext
	)();

const pendingAudio: HTMLAudioElement[] = [];

function resumePendingAudio() {
	while (pendingAudio.length) {
		pendingAudio.pop()!.play().catch(console.error);
	}
	document.removeEventListener('click', resumePendingAudio);
	document.removeEventListener('keydown', resumePendingAudio);
}

/** Returns a silent audio stream for establishing listen-only peer connections.
 *  An oscillator at zero gain keeps the track "live" so WebRTC negotiates
 *  sendrecv (not inactive), ensuring the remote stream is properly received. */
function getSilentStream(): MediaStream {
	if (!silentStream) {
		const ctx = getAudioContext();
		ctx.resume().catch(() => {});
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		gain.gain.value = 0;
		const dest = ctx.createMediaStreamDestination();
		oscillator.connect(gain);
		gain.connect(dest);
		oscillator.start();
		silentStream = dest.stream;
	}
	return silentStream;
}

/** Returns localStream if available, otherwise a silent placeholder. */
function getOutboundStream(): MediaStream {
	return localStream ?? getSilentStream();
}

// ---------------------------------------------------------------------------
// Callbacks (set by the page to bridge voice events into app state)
// ---------------------------------------------------------------------------

export interface VoiceCallbacks {
	/** Called when a remote participant's audio starts playing. */
	onAudio: (userId: string, audio: HTMLAudioElement) => void;
	/** Called to update a participant's average voice level. */
	onAverageVoice: (userId: string, avg: number) => void;
	/** Resolve a PeerJS voiceId to a userId. */
	resolveVoiceId: (voiceId: string) => string | undefined;
	/** Called when a new inbound stream starts (so page can store audio ref). */
	onStream: (userId: string, audio: HTMLAudioElement) => void;
}

let callbacks: VoiceCallbacks | undefined;

export function setCallbacks(cb: VoiceCallbacks) {
	callbacks = cb;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Initialise PeerJS and start listening for calls. */
export function connect() {
	if (peer && !peer.destroyed) {
		peer.destroy();
	}

	peer = new Peer({
		host: 'spectrum.utile.space',
		port: 443,
		path: '/peerjs',
		secure: true,
		config: {
			iceServers: [
				{ urls: 'stun:spectrum.utile.space:3478' },
				{
					urls: 'turn:spectrum.utile.space:3478',
					username: 'testuser',
					credential: 'testpassword'
				}
			]
		}
	});

	peer.on('open', (id) => {
		console.log(`Voice: connected with ID: ${id}`);
		voiceState.peerId = id;
		voiceState.peerConnected = true;
	});

	peer.on('error', (err) => {
		console.error('Voice: peer error', err);
		if (err.type === 'unavailable-id') {
			voiceState.peerConnected = false;
			setTimeout(() => connect(), 1000);
		} else if (err.type === 'peer-unavailable') {
			const match = err.message.match(/[0-9a-fA-F-]{36}$/);
			if (match) {
				callPeer(match[0]);
			}
		}
	});

	peer.on('disconnected', () => {
		voiceState.peerConnected = false;
		console.warn('Voice: disconnected, reconnecting...');
		peer?.reconnect();
	});

	peer.on('call', (call) => {
		// Always answer with a stream so WebRTC negotiates bidirectional media properly.
		// Without a stream, some browsers won't fire the 'stream' event for the remote side.
		call.answer(localStream ?? getOutboundStream());
		call.on('stream', (remoteStream) => _handleRemoteStream(call.peer, remoteStream));
		// Store incoming calls so replaceAudioTrackInActiveCalls can update them too
		activeCalls.set(`in:${call.peer}`, call);
	});
}

/** Disconnect PeerJS and stop all streams. */
export function disconnect() {
	connections.forEach((stream) => stream.getTracks().forEach((t) => t.stop()));
	activeCalls.clear();
	peer?.disconnect();
	voiceState.peerConnected = false;
	voiceState.peerId = undefined;
}

/** Turn on the microphone and start sending audio. */
export async function enableMicrophone() {
	try {
		localStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true
			}
		});

		const ctx = getAudioContext();
		const source = ctx.createMediaStreamSource(localStream);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 512;
		source.connect(analyser);

		const data = new Uint8Array(analyser.frequencyBinCount);
		function detectVoice() {
			analyser.getByteFrequencyData(data);
			const avg = data.reduce((s, v) => s + v, 0) / data.length;
			voiceState.averageVoice = avg > 20 ? avg : 0;
			requestAnimationFrame(detectVoice);
		}
		detectVoice();

		voiceState.microphone = true;
	} catch (err) {
		console.error('Voice: microphone error', err);
	}
}

/** Mute microphone tracks (keeps stream alive). */
export function muteMicrophone() {
	localStream?.getTracks().forEach((t) => (t.enabled = false));
	voiceState.microphone = false;
}

/** Unmute microphone tracks. */
export function unmuteMicrophone() {
	localStream?.getTracks().forEach((t) => (t.enabled = true));
	voiceState.microphone = true;
}

/** Call a remote peer by their PeerJS ID. */
export function callPeer(targetId: string) {
	if (peer) {
		const call = peer.call(targetId, getOutboundStream());
		call.on('stream', (remoteStream) => _handleRemoteStream(targetId, remoteStream));
		activeCalls.set(targetId, call);
	}
}

/** Call with retries (for late-joining participants or slow PeerJS connections). */
export function callPeerWithLimit(targetId: string, maxRetries = 10, attempt = 1) {
	if (peer && voiceState.peerConnected) {
		const call = peer.call(targetId, getOutboundStream());
		call.on('stream', (remoteStream) => _handleRemoteStream(targetId, remoteStream));
		activeCalls.set(targetId, call);
	} else if (attempt <= maxRetries) {
		setTimeout(() => callPeerWithLimit(targetId, maxRetries, attempt + 1), 1000);
	} else {
		console.error(`Voice: failed to call ${targetId} after ${maxRetries} retries`);
	}
}

/**
 * Replace the audio track in all active peer connections.
 * Call this after enabling the microphone so existing connections
 * receive the real audio track instead of the silent placeholder.
 */
export async function replaceAudioTrackInActiveCalls() {
	if (!localStream) return;
	const newTrack = localStream.getAudioTracks()[0];
	if (!newTrack) return;

	for (const [id, call] of activeCalls.entries()) {
		try {
			const peerConnection = (call as unknown as { peerConnection: RTCPeerConnection })
				.peerConnection;
			if (!peerConnection) continue;
			const sender = peerConnection.getSenders().find((s) => s.track?.kind === 'audio');
			if (sender) {
				await sender.replaceTrack(newTrack);
			}
		} catch (e) {
			console.warn(`Voice: failed to replace track in call ${id}`, e);
		}
	}
}

/** Register that a voiceId belongs to a userId (for incoming call routing). */
export function mapVoiceId(voiceId: string, userId: string) {
	voiceIdToUserId.set(voiceId, userId);
}

/** Set playback volume for a remote participant (0-100). */
export function setParticipantVolume(audio: HTMLAudioElement | undefined, volume: number) {
	if (audio) audio.volume = volume / 100;
}

/** Returns the local stream (needed to answer calls). */
export function getLocalStream() {
	return localStream;
}

/** Returns the current peer ID. */
export function getPeerId() {
	return voiceState.peerId;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve a PeerJS voiceId to a userId, using both the page callback and the internal map. */
function _resolveVoiceId(voiceId: string): string | undefined {
	return callbacks?.resolveVoiceId(voiceId) ?? voiceIdToUserId.get(voiceId);
}

/** Handle a remote stream (shared by incoming and outgoing call handlers). */
function _handleRemoteStream(voiceId: string, remoteStream: MediaStream) {
	const userId = _resolveVoiceId(voiceId);
	const audio = _playRemoteAudio(voiceId, remoteStream);

	if (userId && audio) {
		callbacks?.onAudio(userId, audio);
	}

	if (connections.has(voiceId)) {
		connections
			.get(voiceId)
			?.getTracks()
			.forEach((t) => t.stop());
	}
	connections.set(voiceId, remoteStream);
}

function _playRemoteAudio(voiceId: string, stream: MediaStream): HTMLAudioElement | undefined {
	const userId = _resolveVoiceId(voiceId);
	if (!userId) return;

	const audio = new Audio();
	audio.srcObject = stream;
	audio.autoplay = true;
	audio.play().catch(() => {
		pendingAudio.push(audio);
		document.addEventListener('click', resumePendingAudio);
		document.addEventListener('keydown', resumePendingAudio);
	});

	const ctx = getAudioContext();
	const source = ctx.createMediaStreamSource(stream);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	source.connect(analyser);

	const data = new Uint8Array(analyser.frequencyBinCount);
	function detectVoice() {
		analyser.getByteFrequencyData(data);
		const avg = data.reduce((s, v) => s + v, 0) / data.length;
		callbacks?.onAverageVoice(userId!, avg > 20 ? avg : 0);
		requestAnimationFrame(detectVoice);
	}
	detectVoice();

	return audio;
}
