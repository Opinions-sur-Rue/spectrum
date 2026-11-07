import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import BrowserTranscriptControl from './BrowserTranscriptControl.svelte';
import type { RoomState } from './room-client';

const fixture = vi.hoisted(() => ({
	ready: () => {},
	stop: vi.fn(),
	captureTrack: vi.fn(),
	selected: vi.fn(),
	load: vi.fn(),
	gpuAvailable: false
}));
vi.mock('./browser-stt', () => ({
	browserSTTSupported: () => true,
	browserSTTWebGPUAvailable: async () => fixture.gpuAvailable,
	BrowserSTT: class {
		constructor(
			_language: string,
			callbacks: { ready: () => void },
			model: string,
			backend: string
		) {
			fixture.ready = callbacks.ready;
			fixture.selected(model, backend);
		}
		load = fixture.load;
		stop = fixture.stop;
		captureTrack = fixture.captureTrack;
	}
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	fixture.gpuAvailable = false;
});

it('shows base download size but loads neither model until confirmation', async () => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	const view = render(BrowserTranscriptControl, {
		room: {
			roomId: 'room',
			role: 'admin',
			voice: { generation: 4 },
			settings: { transcriptionEnabled: true, transcriptionLanguage: 'fr' }
		} as unknown as RoomState,
		track: {} as MediaStreamTrack,
		ready: true,
		session: null,
		failure: null,
		send: vi.fn(() => true)
	});
	const toggle = view.getByTestId('browser-stt-toggle');
	await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
	await fireEvent.click(toggle);
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	expect(view.getByRole('dialog').textContent).toContain('110');
	expect(fixture.load).not.toHaveBeenCalled();
	await fireEvent.click(view.getByRole('dialog').querySelector('button')!);
	expect(fixture.load).not.toHaveBeenCalled();
	await fireEvent.click(toggle);
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('base', 'wasm');
	expect(fixture.load).toHaveBeenCalledOnce();
});

it('offers an explicit GPU backend only after hardware WebGPU is detected', async () => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	fixture.gpuAvailable = true;
	const view = render(BrowserTranscriptControl, {
		room: {
			roomId: 'room',
			role: 'admin',
			voice: { generation: 4 },
			settings: { transcriptionEnabled: true, transcriptionLanguage: 'fr' }
		} as unknown as RoomState,
		track: {} as MediaStreamTrack,
		ready: true,
		session: null,
		failure: null,
		send: vi.fn(() => true)
	});
	const toggle = view.getByTestId('browser-stt-toggle');
	await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
	await fireEvent.click(toggle);
	const gpu = await waitFor(() => view.getByTestId('browser-stt-webgpu'));
	await fireEvent.click(gpu);
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'small' } });
	expect((gpu as HTMLInputElement).checked).toBe(true);
	expect(view.getByRole('dialog').textContent).toContain('515');
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('small', 'webgpu');
	expect(fixture.load).toHaveBeenCalledOnce();
});

it('retires a late admission after cancellation without starting capture', async () => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	const room = {
		roomId: 'room',
		role: 'admin',
		voice: { generation: 4 },
		settings: { transcriptionEnabled: true, transcriptionLanguage: 'fr' }
	} as unknown as RoomState;
	const send = vi.fn<(op: string, payload: unknown) => boolean>(() => true);
	const view = render(BrowserTranscriptControl, {
		room,
		track: {} as MediaStreamTrack,
		ready: true,
		session: null,
		failure: null,
		send
	});
	const toggle = view.getByTestId('browser-stt-toggle');
	await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
	await fireEvent.click(toggle);
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	fixture.ready();
	await tick();
	const request = send.mock.calls.find(([op]) => op === 'transcript.start')?.[1] as {
		requestId: string;
	};
	expect(request.requestId).toBeTruthy();
	await fireEvent.click(toggle);
	const session = {
		roomId: 'room',
		requestId: request.requestId,
		sessionId: 'late',
		generation: 4
	};
	await view.rerender({ session });
	await waitFor(() => expect(send).toHaveBeenCalledWith('transcript.stop', session));
	expect(fixture.captureTrack).not.toHaveBeenCalled();
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
});
