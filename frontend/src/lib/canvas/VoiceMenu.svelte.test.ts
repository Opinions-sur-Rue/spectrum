import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import VoiceMenu from './VoiceMenu.svelte';
import type { RoomState } from './room-client';
import type { VoiceCredentials, VoiceConnectionStatus } from './voice-connection';
import { m } from '$lib/paraglide/messages.js';

const fixture = vi.hoisted(() => ({
	callbacks: null as null | {
		permissions: (canPublish: boolean) => void;
		disconnected: () => void;
		status: (status: VoiceConnectionStatus) => void;
		microphone: (enabled: boolean, busy: boolean) => void;
	},
	connect: vi.fn(),
	disconnect: vi.fn(),
	toggle: vi.fn(),
	disable: vi.fn(),
	microphone: false,
	waitForConnect: null as Promise<void> | null
}));

vi.mock('./voice-connection', () => ({
	VoiceConnection: class {
		constructor(_container: HTMLElement, callbacks: NonNullable<typeof fixture.callbacks>) {
			fixture.callbacks = callbacks;
		}
		async setMicrophoneDevice() {}
		async setPublishAllowed(allowed: boolean) {
			fixture.callbacks!.permissions(allowed);
			if (!allowed) {
				fixture.microphone = false;
				fixture.callbacks!.microphone(false, false);
			}
		}
		async connect(credentials: VoiceCredentials) {
			await this.disconnect();
			fixture.callbacks!.status('connecting');
			fixture.connect(credentials);
			await fixture.waitForConnect;
			fixture.callbacks!.status('connected');
		}
		async disconnect() {
			fixture.disconnect();
			fixture.microphone = false;
			fixture.callbacks!.microphone(false, false);
			fixture.callbacks!.status('idle');
		}
		async toggleMicrophone() {
			fixture.toggle();
			fixture.microphone = !fixture.microphone;
			fixture.callbacks!.microphone(fixture.microphone, false);
		}
		async disableMicrophone() {
			fixture.disable();
			fixture.microphone = false;
			fixture.callbacks!.microphone(false, false);
		}
	}
}));

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	fixture.microphone = false;
	fixture.waitForConnect = null;
});

async function setup() {
	const room = {
		roomId: 'room',
		userId: 'member',
		role: 'admin',
		voice: { available: true, generation: 0 },
		settings: { transcriptionEnabled: false },
		members: []
	} as unknown as RoomState;
	const send = vi.fn<(op: string, payload: unknown) => boolean>(() => true);
	const view = render(VoiceMenu, {
		room,
		ready: true,
		credentials: null,
		failure: null,
		invalidation: 0,
		send
	});
	await fireEvent.click(view.getByTestId('audio-toggle'));
	async function credentials(canPublish = true) {
		await waitFor(() => expect(send).toHaveBeenCalled());
		const payload = send.mock.lastCall![1] as { requestId: string };
		await view.rerender({
			credentials: {
				roomId: 'room',
				requestId: payload.requestId,
				url: 'ws://localhost',
				token: 'fixture',
				generation: 0,
				canPublish
			}
		});
		await waitFor(() =>
			expect(view.getByTestId('voice-controls').dataset.status).toBe('connected')
		);
	}
	await credentials();
	const mic = () => view.getByTestId('voice-controls').querySelectorAll('button')[1];
	return { view, room, send, credentials, mic };
}

it('keeps LiveKit and microphone alive while the application WebSocket reconnects', async () => {
	const { view, mic, send } = await setup();
	await fireEvent.click(mic());
	const disconnects = fixture.disconnect.mock.calls.length;
	await view.rerender({ ready: false });
	await view.rerender({ ready: true });
	expect(fixture.disconnect).toHaveBeenCalledTimes(disconnects);
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	expect(send).toHaveBeenCalledTimes(1);
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('true');
});

it('groups microphone, push-to-talk and local transcription in one audio menu', async () => {
	const { view, room } = await setup();
	await view.rerender({
		room: {
			...room,
			transcription: { mode: 'browser', available: true, ready: true },
			settings: { ...room.settings, transcriptionEnabled: true }
		}
	});
	const summary = view.getByTestId('audio-options');
	const menu = summary.closest('details')!;
	expect(view.queryByTestId('mic-options')).toBeNull();
	expect(view.getAllByTestId('audio-options')).toHaveLength(1);
	expect(menu.contains(view.getByTestId('mic-device'))).toBe(true);
	expect(menu.contains(view.getByTestId('push-to-talk-mode'))).toBe(true);
	expect(menu.contains(view.getByTestId('browser-stt-controls'))).toBe(true);
});

it.each([true, false])(
	'restores only an active microphone after involuntary rejoin (%s)',
	async (active) => {
		const { view, mic, credentials, send } = await setup();
		await fireEvent.click(mic());
		if (!active) await fireEvent.click(mic());
		const toggles = fixture.toggle.mock.calls.length;
		await view.rerender({ invalidation: 1 });
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await credentials();
		await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(toggles + Number(active)));
		expect(view.getByTestId('voice-controls').dataset.microphone).toBe(String(active));
	}
);

it('does not restore capture without a fresh publishing grant', async () => {
	const { view, mic, credentials, send } = await setup();
	await fireEvent.click(mic());
	await view.rerender({ invalidation: 1 });
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	await credentials(false);
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
});

it('clears microphone intent on demotion, including later promotion', async () => {
	const { view, room, mic, send } = await setup();
	await fireEvent.click(mic());
	const disconnects = fixture.disconnect.mock.calls.length;
	await view.rerender({ room: { ...room, role: 'spectator' } });
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
	fixture.callbacks!.permissions(true);
	await view.rerender({ room });
	expect(send).toHaveBeenCalledTimes(1);
	expect(fixture.disconnect).toHaveBeenCalledTimes(disconnects);
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
});

it('rejoins after a final SDK disconnect, but not an ordinary idle status', async () => {
	const { view, mic, send, credentials } = await setup();
	await fireEvent.click(mic());
	fixture.callbacks!.microphone(false, false);
	fixture.callbacks!.status('idle');
	await view.rerender({ ready: true });
	expect(send).toHaveBeenCalledTimes(1);
	fixture.callbacks!.disconnected();
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	await credentials();
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(2));
});

it('waits for application readiness before restoring the microphone', async () => {
	const { view, mic, send, credentials } = await setup();
	await fireEvent.click(mic());
	let release!: () => void;
	fixture.waitForConnect = new Promise<void>((resolve) => {
		release = resolve;
	});
	await view.rerender({ invalidation: 1 });
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	const joining = credentials();
	await waitFor(() => expect(fixture.connect).toHaveBeenCalledTimes(2));
	await view.rerender({ ready: false });
	release();
	await joining;
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	await view.rerender({ ready: true });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(2));
});

it('never restores microphone intent across a transcription consent change', async () => {
	const { view, room, mic, send, credentials } = await setup();
	await fireEvent.click(mic());
	await view.rerender({
		room: {
			...room,
			settings: { ...room.settings, transcriptionEnabled: true },
			transcription: { available: true, ready: true, mode: 'server' }
		}
	});
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	await credentials();
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
});

it('requires a fresh hold after application readiness returns', async () => {
	const { view } = await setup();
	await fireEvent.click(view.getByTestId('push-to-talk-mode'));
	const hold = view.getByTestId('push-to-talk');
	expect(fixture.toggle).not.toHaveBeenCalled();
	await fireEvent.keyDown(hold, { key: ' ', code: 'Space' });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(1));
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('true');
	await view.rerender({ ready: false });
	await waitFor(() => expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false'));
	await view.rerender({ ready: true });
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	await fireEvent.keyUp(hold, { key: ' ', code: 'Space' });
	await fireEvent.keyDown(hold, { key: ' ', code: 'Space' });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(2));
	await fireEvent.keyUp(hold, { key: ' ', code: 'Space' });
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
});

it('never restores a held microphone after demotion and promotion', async () => {
	const { view, room } = await setup();
	await fireEvent.click(view.getByTestId('push-to-talk-mode'));
	await fireEvent.keyDown(view.getByTestId('push-to-talk'), { key: ' ', code: 'Space' });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(1));
	await view.rerender({ room: { ...room, role: 'spectator' } });
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
	fixture.callbacks!.permissions(true);
	await view.rerender({ room });
	expect(view.getByTestId('push-to-talk')).toHaveAttribute('aria-pressed', 'false');
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
});

it('consent in push-to-talk mode grants access but does not start capture', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value(this: HTMLDialogElement) {
			this.setAttribute('open', '');
		}
	});
	try {
		const { view, room, send, credentials } = await setup();
		await fireEvent.click(view.getByTestId('push-to-talk-mode'));
		await view.rerender({
			room: {
				...room,
				settings: { ...room.settings, transcriptionEnabled: true },
				transcription: { available: true, ready: true, mode: 'server' }
			}
		});
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await credentials(false);
		expect(view.getByTestId('push-to-talk')).toBeDisabled();
		await fireEvent.click(view.getByRole('button', { name: m.ux_enable_microphone() }));
		await fireEvent.click(view.getByRole('button', { name: m.ptt_consent_accept() }));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
		expect(send.mock.lastCall?.[1]).toMatchObject({ transcriptionConsent: true });
		await credentials(true);
		expect(view.getByTestId('push-to-talk')).toBeEnabled();
		expect(fixture.toggle).not.toHaveBeenCalled();
		expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
	} finally {
		if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', descriptor);
		else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
	}
});

it('moderation clears normal mic intent and only explicit self-resume requests publishing', async () => {
	const { view, room, mic, send, credentials } = await setup();
	await fireEvent.click(mic());
	const member = { id: room.userId, nickname: 'Me', role: room.role, microphoneMuted: true };
	await view.rerender({ room: { ...room, members: [member] } });
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	await fireEvent.click(view.getByRole('button', { name: m.voice_resume_self() }));
	expect(send.mock.lastCall?.[0]).toBe('voice.resume');
	await view.rerender({ room: { ...room, members: [{ ...member, microphoneMuted: false }] } });
	await credentials();
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(2));
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('true');
});

it('another tab clearing moderation does not restore this tabs old microphone intent', async () => {
	const { view, room, mic } = await setup();
	await fireEvent.click(mic());
	const member = { id: room.userId, nickname: 'Me', role: room.role, microphoneMuted: true };
	await view.rerender({ room: { ...room, members: [member] } });
	fixture.callbacks!.permissions(true);
	await view.rerender({ room: { ...room, members: [{ ...member, microphoneMuted: false }] } });
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
});

it('self-resume in hold mode restores permission, never the previous held press', async () => {
	const { view, room, send, credentials } = await setup();
	await fireEvent.click(view.getByTestId('push-to-talk-mode'));
	await fireEvent.keyDown(view.getByTestId('push-to-talk'), { key: ' ', code: 'Space' });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(1));
	const member = { id: room.userId, nickname: 'Me', role: room.role, microphoneMuted: true };
	await view.rerender({ room: { ...room, members: [member] } });
	expect(view.getByTestId('voice-controls').dataset.microphone).toBe('false');
	await fireEvent.click(view.getByRole('button', { name: m.voice_resume_self() }));
	expect(send.mock.lastCall?.[0]).toBe('voice.resume');
	await view.rerender({ room: { ...room, members: [{ ...member, microphoneMuted: false }] } });
	await credentials();
	expect(fixture.toggle).toHaveBeenCalledTimes(1);
	expect(view.getByTestId('push-to-talk')).toHaveAttribute('aria-pressed', 'false');
	await fireEvent.keyUp(view.getByTestId('push-to-talk'), { key: ' ', code: 'Space' });
	await fireEvent.keyDown(view.getByTestId('push-to-talk'), { key: ' ', code: 'Space' });
	await waitFor(() => expect(fixture.toggle).toHaveBeenCalledTimes(2));
});

it('reports only its own turn boundaries and closes an open turn on unmount', async () => {
	const { view, room, send } = await setup();
	await view.rerender({ speakers: ['m_somebody_else'] });
	expect(send.mock.calls.filter(([op]) => op === 'voice.speaking')).toHaveLength(0);
	await view.rerender({ speakers: [room.userId] });
	await waitFor(() => expect(send).toHaveBeenLastCalledWith('voice.speaking', { speaking: true }));
	await view.rerender({ speakers: [] });
	await waitFor(() => expect(send).toHaveBeenLastCalledWith('voice.speaking', { speaking: false }));
	await view.rerender({ speakers: [room.userId] });
	await waitFor(() => expect(send).toHaveBeenLastCalledWith('voice.speaking', { speaking: true }));
	view.unmount();
	expect(send).toHaveBeenLastCalledWith('voice.speaking', { speaking: false });
});
