import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import BrowserTranscriptControl from './BrowserTranscriptControl.svelte';
import type { RoomState } from './room-client';
import type { STTLoadProgress, BrowserSTTFailureReason } from './browser-stt';

const fixture = vi.hoisted(() => ({
	ready: () => {},
	progress: (() => {}) as (value: STTLoadProgress) => void,
	failure: (() => {}) as (reason: BrowserSTTFailureReason) => void,
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
			callbacks: {
				ready: () => void;
				progress: (value: STTLoadProgress) => void;
				failure: (reason: BrowserSTTFailureReason) => void;
			},
			model: string,
			backend: string
		) {
			fixture.ready = callbacks.ready;
			fixture.progress = callbacks.progress;
			fixture.failure = callbacks.failure;
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
	expect(
		Array.from(
			view.getByTestId('browser-stt-model').querySelectorAll('option'),
			(option) => option.value
		)
	).toEqual(['parakeet', 'base']);
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

it.each(['fr', 'en', 'auto'] as const)(
	'shows a supported default before consent for %s',
	async (language) => {
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.open = true;
		});
		const view = render(BrowserTranscriptControl, {
			room: {
				roomId: 'room',
				role: 'admin',
				voice: { generation: 4 },
				settings: { transcriptionEnabled: true, transcriptionLanguage: language }
			} as unknown as RoomState,
			track: {} as MediaStreamTrack,
			ready: true,
			session: null,
			failure: null,
			send: vi.fn(() => true)
		});
		await waitFor(() =>
			expect(view.getByTestId('browser-stt-toggle').hasAttribute('disabled')).toBe(false)
		);
		await fireEvent.click(view.getByTestId('browser-stt-toggle'));
		expect((view.getByTestId('browser-stt-model') as HTMLSelectElement).value).toBe(
			language === 'auto' ? 'base' : 'parakeet'
		);
		expect(fixture.load).not.toHaveBeenCalled();
	}
);

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
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	await fireEvent.click(gpu);
	expect((gpu as HTMLInputElement).checked).toBe(true);
	expect(view.getByRole('dialog').textContent).toContain('180');
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('base', 'webgpu');
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

it('loads Parakeet only after consent and forces CPU even with hardware GPU available', async () => {
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
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	await fireEvent.click(gpu);
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'parakeet' } });
	expect((gpu as HTMLInputElement).checked).toBe(false);
	expect((gpu as HTMLInputElement).disabled).toBe(true);
	expect(view.getByRole('dialog').textContent).toContain('225');
	expect(view.getByRole('dialog').textContent).toContain('CC-BY-4.0');
	expect(fixture.load).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('parakeet', 'wasm');
	expect(fixture.load).toHaveBeenCalledOnce();
});

it('disables Parakeet for auto language and rejects a forged selection before loading', async () => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	const view = render(BrowserTranscriptControl, {
		room: {
			roomId: 'room',
			role: 'admin',
			voice: { generation: 4 },
			settings: { transcriptionEnabled: true, transcriptionLanguage: 'auto' }
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
	const select = view.getByTestId('browser-stt-model');
	expect(select.querySelector<HTMLOptionElement>('option[value="parakeet"]')?.disabled).toBe(true);
	await fireEvent.change(select, { target: { value: 'parakeet' } });
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.load).not.toHaveBeenCalled();
	expect(view.getByRole('alert').textContent).toBe(m.browser_stt_parakeet_hint());
});

it('shows byte/percentage progress, then indeterminate initialization instead of a frozen loading message', async () => {
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
	await fireEvent.click(view.getByTestId('browser-stt-toggle'));
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	fixture.progress({ phase: 'download', loaded: 10000000, total: 20000000, asset: 'encoder' });
	await waitFor(() =>
		expect(view.getByTestId('browser-stt-progress').getAttribute('value')).toBe('50')
	);
	expect(view.getByRole('status').textContent).toContain('10.0 / 20.0');
	fixture.progress({ phase: 'initializing', loaded: 20000000, total: 20000000, asset: 'encoder' });
	await waitFor(() =>
		expect(view.getByTestId('browser-stt-progress').hasAttribute('value')).toBe(false)
	);
	expect(view.getByRole('status').textContent).toBe(m.browser_stt_initializing_short());
});

it.each(['download', 'assets', 'engine'] as const)(
	'shows actionable %s startup failure',
	async (reason) => {
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
		await fireEvent.click(view.getByTestId('browser-stt-toggle'));
		await fireEvent.click(view.getByTestId('browser-stt-confirm'));
		fixture.failure(reason);
		const messages = {
			download: m.browser_stt_download_failed(),
			assets: m.browser_stt_assets_failed(),
			engine: m.browser_stt_engine_failed()
		};
		await waitFor(() => expect(view.getByRole('alert').textContent).toBe(messages[reason]));
		expect(fixture.stop).toHaveBeenCalledOnce();
	}
);
