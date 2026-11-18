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
	pauseCapture: vi.fn(),
	captureTrack: vi.fn(),
	selected: vi.fn(),
	load: vi.fn(),
	instances: [] as {
		ready: () => void;
		failure: (reason: BrowserSTTFailureReason) => void;
		segment: (value: unknown) => void;
	}[],
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
				segment: (value: unknown) => void;
			},
			model: string,
			backend: string
		) {
			fixture.ready = callbacks.ready;
			fixture.progress = callbacks.progress;
			fixture.failure = callbacks.failure;
			fixture.instances.push(callbacks);
			fixture.selected(model, backend);
		}
		load = fixture.load;
		stop = fixture.stop;
		pauseCapture = fixture.pauseCapture;
		captureTrack = fixture.captureTrack;
	}
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	fixture.gpuAvailable = false;
	fixture.instances = [];
	window.history.replaceState({}, '', '/');
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

it('defaults compatible Base to GPU with combined fallback consent budget before loading', async () => {
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
	await waitFor(() =>
		expect((view.getByTestId('browser-stt-webgpu') as HTMLInputElement).checked).toBe(true)
	);
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	const gpu = await waitFor(() => view.getByTestId('browser-stt-webgpu'));
	expect((gpu as HTMLInputElement).checked).toBe(true);
	expect(view.getByRole('dialog').textContent).toContain('290');
	expect(view.getByRole('dialog').textContent).toContain('FP16');
	expect(view.getByRole('dialog').textContent).toContain('q8');
	expect(fixture.load).not.toHaveBeenCalled();
	expect(fixture.captureTrack).not.toHaveBeenCalled();
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

it('prepares without a microphone, survives track loss while loading, then admits only a publishing track', async () => {
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
		track: null,
		ready: true,
		session: null,
		failure: null,
		send
	});
	await fireEvent.click(view.getByTestId('browser-stt-toggle'));
	expect(fixture.load).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.load).toHaveBeenCalledOnce();
	const track = {} as MediaStreamTrack;
	await view.rerender({ track });
	await view.rerender({ track: null });
	fixture.progress({ phase: 'download', loaded: 10, total: 100, asset: 'encoder' });
	await waitFor(() =>
		expect(view.getByTestId('browser-stt-progress').getAttribute('value')).toBe('10')
	);
	expect(fixture.stop).not.toHaveBeenCalled();
	fixture.ready();
	await waitFor(() =>
		expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('prepared')
	);
	expect(send).not.toHaveBeenCalled();
	expect(fixture.captureTrack).not.toHaveBeenCalled();
	await view.rerender({ track });
	await waitFor(() => expect(send).toHaveBeenCalledWith('transcript.start', expect.anything()));
	const request = send.mock.calls.find(([op]) => op === 'transcript.start')?.[1] as {
		requestId: string;
	};
	const session = {
		roomId: 'room',
		requestId: request.requestId,
		sessionId: 'first',
		generation: 4
	};
	await view.rerender({ session });
	await waitFor(() =>
		expect(fixture.captureTrack).toHaveBeenCalledWith(track, expect.any(Function))
	);
	await view.rerender({ track: null });
	await waitFor(() => expect(send).toHaveBeenCalledWith('transcript.stop', session));
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('prepared');
	expect(fixture.stop).not.toHaveBeenCalled();
	await view.rerender({ track });
	await waitFor(() =>
		expect(send.mock.calls.filter(([op]) => op === 'transcript.start')).toHaveLength(2)
	);
	expect(fixture.load).toHaveBeenCalledOnce();
});

it.each(['room', 'generation', 'language', 'role', 'disabled'] as const)(
	'fences late readiness after %s changes',
	async (change) => {
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
			track: null,
			ready: true,
			session: null,
			failure: null,
			send
		});
		await fireEvent.click(view.getByTestId('browser-stt-toggle'));
		await fireEvent.click(view.getByTestId('browser-stt-confirm'));
		const changed = structuredClone(room);
		if (change === 'room') changed.roomId = 'other';
		if (change === 'generation') changed.voice!.generation++;
		if (change === 'language') changed.settings.transcriptionLanguage = 'en';
		if (change === 'role') changed.role = 'spectator';
		if (change === 'disabled') changed.settings.transcriptionEnabled = false;
		await view.rerender({ room: changed });
		fixture.ready();
		await tick();
		expect(fixture.stop).toHaveBeenCalledOnce();
		expect(send).not.toHaveBeenCalled();
		expect(fixture.captureTrack).not.toHaveBeenCalled();
		expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
	}
);

it('defaults compatible Parakeet to GPU without query flag, loading only after consent', async () => {
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
	const parakeetGpu = await waitFor(() => view.getByTestId('browser-stt-webgpu'));
	expect((parakeetGpu as HTMLInputElement).checked).toBe(true);
	expect((parakeetGpu as HTMLInputElement).disabled).toBe(false);
	expect(view.getByRole('dialog').textContent).toContain('255');
	expect(view.getByRole('dialog').textContent).toContain('CC-BY-4.0');
	expect(fixture.load).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('parakeet', 'webgpu');
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

async function prepareGpu(track: MediaStreamTrack | null = null) {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	fixture.gpuAvailable = true;
	const room = {
		roomId: 'room',
		role: 'admin',
		voice: { generation: 4 },
		settings: { transcriptionEnabled: true, transcriptionLanguage: 'fr' }
	} as unknown as RoomState;
	const send = vi.fn<(op: string, payload: unknown) => boolean>(() => true);
	const view = render(BrowserTranscriptControl, {
		room,
		track,
		ready: true,
		session: null,
		failure: null,
		send
	});
	await fireEvent.click(view.getByTestId('browser-stt-toggle'));
	await waitFor(() =>
		expect((view.getByTestId('browser-stt-webgpu') as HTMLInputElement).checked).toBe(true)
	);
	expect(fixture.load).not.toHaveBeenCalled();
	expect(fixture.captureTrack).not.toHaveBeenCalled();
	return { view, room, send };
}

it('allows explicit CPU choice despite compatible GPU', async () => {
	const { view } = await prepareGpu();
	await fireEvent.click(view.getByTestId('browser-stt-webgpu'));
	expect(view.getByRole('dialog').textContent).toContain('225');
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected).toHaveBeenCalledWith('parakeet', 'wasm');
});

it('retries GPU once on CPU without microphone capture, resets progress and fences retired callbacks', async () => {
	const { view, send } = await prepareGpu();
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	const old = fixture.instances[0];
	fixture.progress({ phase: 'download', loaded: 90, total: 100, asset: 'encoder' });
	old.failure('gpu');
	await tick();
	expect(fixture.selected.mock.calls).toEqual([
		['parakeet', 'webgpu'],
		['parakeet', 'wasm']
	]);
	expect(fixture.stop).toHaveBeenCalledOnce();
	expect(view.getByTestId('browser-stt-progress').hasAttribute('value')).toBe(false);
	expect(view.getByTestId('browser-stt-fallback').textContent).toBe(m.browser_stt_gpu_fallback());
	old.ready();
	old.failure('gpu');
	old.segment({ text: 'stale' });
	await tick();
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('loading');
	fixture.ready();
	await tick();
	expect(send).not.toHaveBeenCalled();
	expect(fixture.captureTrack).not.toHaveBeenCalled();
	fixture.failure('gpu'); // Even a CPU-side GPU-looking failure cannot retry again.
	await tick();
	expect(fixture.load).toHaveBeenCalledTimes(2);
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
});

it.each(['parakeet', 'base'])(
	'retires active %s GPU lease and obtains a fresh CPU lease, never publishing stale text',
	async (model) => {
		const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
		const { view, send } = await prepareGpu(track);
		if (model === 'base') {
			await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
			await waitFor(() =>
				expect(view.getByTestId('browser-stt-confirm').hasAttribute('disabled')).toBe(false)
			);
		}
		await fireEvent.click(view.getByTestId('browser-stt-confirm'));
		const old = fixture.instances[0];
		old.ready();
		await tick();
		const first = send.mock.calls.find(([op]) => op === 'transcript.start')![1] as {
			requestId: string;
		};
		const oldLease = {
			roomId: 'room',
			requestId: first.requestId,
			sessionId: 'gpu-lease',
			generation: 4
		};
		await view.rerender({ session: oldLease });
		expect(fixture.captureTrack).toHaveBeenCalledOnce();
		old.failure('gpu');
		await tick();
		expect(send).toHaveBeenCalledWith('transcript.stop', oldLease);
		old.segment({ text: 'stale' });
		fixture.ready();
		await tick();
		const starts = send.mock.calls.filter(([op]) => op === 'transcript.start');
		expect(starts).toHaveLength(2);
		const second = starts[1][1] as { requestId: string };
		expect(second.requestId).not.toBe(first.requestId);
		const cpuLease = { ...oldLease, requestId: second.requestId, sessionId: 'cpu-lease' };
		await view.rerender({ session: cpuLease });
		expect(fixture.captureTrack).toHaveBeenCalledTimes(2);
		expect(view.getByRole('status').textContent).toContain('CPU');
		expect(view.getByRole('status').textContent).not.toContain('WebGPU');
		expect(send.mock.calls.filter(([op]) => op === 'transcript.publish')).toHaveLength(0);
		expect(track.stop).not.toHaveBeenCalled();
	}
);

it('does not capture after microphone goes off during fallback and retires late GPU admission', async () => {
	const { view, send } = await prepareGpu({} as MediaStreamTrack);
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	fixture.ready();
	await tick();
	const first = send.mock.calls.find(([op]) => op === 'transcript.start')![1] as {
		requestId: string;
	};
	fixture.failure('gpu');
	await view.rerender({ track: null });
	const late = { roomId: 'room', requestId: first.requestId, sessionId: 'late-gpu', generation: 4 };
	await view.rerender({ session: late });
	expect(send).toHaveBeenCalledWith('transcript.stop', late);
	fixture.ready();
	await tick();
	expect(fixture.captureTrack).not.toHaveBeenCalled();
	expect(send.mock.calls.filter(([op]) => op === 'transcript.start')).toHaveLength(1);
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('prepared');
});

it('loads Base CPU variant only after GPU failure under combined 290 MB consent, with truthful notice', async () => {
	const { view } = await prepareGpu();
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	const gpu = await waitFor(() => view.getByTestId('browser-stt-webgpu'));
	expect((gpu as HTMLInputElement).checked).toBe(true);
	expect(view.getByRole('dialog').textContent).toContain('290');
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	expect(fixture.selected.mock.calls).toEqual([['base', 'webgpu']]);
	fixture.failure('gpu');
	await tick();
	expect(fixture.selected.mock.calls).toEqual([
		['base', 'webgpu'],
		['base', 'wasm']
	]);
	expect(fixture.load).toHaveBeenCalledTimes(2);
	expect(view.getByTestId('browser-stt-fallback').textContent?.trim()).toBe(
		m.browser_stt_gpu_fallback_base()
	);
	fixture.failure('failed');
	await tick();
	expect(fixture.load).toHaveBeenCalledTimes(2);
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
});

it('lets compatible Base opt out of GPU to 110 MB CPU-only consent and never retries CPU failure', async () => {
	const { view } = await prepareGpu();
	await fireEvent.change(view.getByTestId('browser-stt-model'), { target: { value: 'base' } });
	const gpu = await waitFor(() => view.getByTestId('browser-stt-webgpu'));
	await fireEvent.click(gpu);
	expect((gpu as HTMLInputElement).checked).toBe(false);
	expect(view.getByRole('dialog').textContent).toContain('110');
	expect(view.getByRole('dialog').textContent).not.toContain('290');
	await fireEvent.click(view.getByTestId('browser-stt-confirm'));
	fixture.failure('gpu');
	await tick();
	expect(fixture.selected.mock.calls).toEqual([['base', 'wasm']]);
	expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
});

it.each(['stop', 'ready', 'room', 'generation', 'language', 'role'] as const)(
	'never retries after %s cancellation',
	async (change) => {
		const { view, room } = await prepareGpu();
		await fireEvent.click(view.getByTestId('browser-stt-confirm'));
		const old = fixture.instances[0];
		if (change === 'stop') await fireEvent.click(view.getByTestId('browser-stt-toggle'));
		else if (change === 'ready') await view.rerender({ ready: false });
		else {
			const changed = structuredClone(room);
			if (change === 'room') changed.roomId = 'other';
			if (change === 'generation') changed.voice!.generation++;
			if (change === 'language') changed.settings.transcriptionLanguage = 'en';
			if (change === 'role') changed.role = 'spectator';
			await view.rerender({ room: changed });
		}
		old.failure('gpu');
		old.ready();
		await tick();
		expect(fixture.load).toHaveBeenCalledOnce();
		expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
	}
);

it.each(['assets', 'download', 'engine', 'slow', 'failed'] as const)(
	'never retries GPU %s failure',
	async (reason) => {
		const { view } = await prepareGpu();
		await fireEvent.click(view.getByTestId('browser-stt-confirm'));
		fixture.failure(reason);
		await tick();
		expect(fixture.load).toHaveBeenCalledOnce();
		expect(view.getByTestId('browser-stt-controls').getAttribute('data-state')).toBe('off');
	}
);
