<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import {
		BrowserSTT,
		browserSTTSupported,
		browserSTTWebGPUAvailable,
		type BrowserTranscriptSession,
		type BrowserTranscriptFailure,
		type BrowserSTTModel,
		type BrowserSTTBackend
	} from './browser-stt';
	import type { RoomState } from './room-client';
	let {
		room,
		track,
		ready,
		session,
		failure,
		send,
		// eslint-disable-next-line no-useless-assignment -- Bindable output consumed by the parent.
		active = $bindable(false)
	}: {
		room: RoomState;
		track: MediaStreamTrack | null;
		ready: boolean;
		session: BrowserTranscriptSession | null;
		failure: BrowserTranscriptFailure | null;
		send: (op: string, payload: unknown) => boolean;
		active?: boolean;
	} = $props();
	let supported = $state(false);
	let phase = $state<'off' | 'loading' | 'starting' | 'active'>('off');
	let consentOpen = $state(false);
	let model = $state<BrowserSTTModel>('tiny');
	let useGpu = $state(false);
	let gpuAvailable = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let error = $state('');
	let request = $state<string | null>(null);
	let handledSession = $state('');
	let lease = $state.raw<BrowserTranscriptSession | null>(null);
	let engine: BrowserSTT | null = null;
	let chosenTrack: MediaStreamTrack | null = null;
	let generation = 0;
	let language = '';
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let admissionTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		active = phase !== 'off';
	});
	onMount(() => {
		supported = browserSTTSupported();
	});
	onDestroy(() => stop());
	$effect(() => {
		if (!consentOpen) return;
		void browserSTTWebGPUAvailable().then((available) => {
			gpuAvailable = available;
			if (!available) useGpu = false;
		});
	});
	function downloadSize() {
		if (model === 'small') return '515';
		return model === 'base' ? (useGpu ? '180' : '110') : useGpu ? '110' : '75';
	}
	$effect(() => {
		if (consentOpen && dialog && !dialog.open) dialog.showModal();
	});
	function stop(message = '') {
		clearInterval(heartbeat);
		clearTimeout(admissionTimer);
		if (lease && ready) send('transcript.stop', lease);
		engine?.stop();
		engine = null;
		lease = null;
		request = null;
		phase = 'off';
		chosenTrack = null;
		error = message;
	}
	function begin() {
		consentOpen = false;
		if (!track || !supported || !ready) return;
		if (model === 'small' && !useGpu) {
			error = m.browser_stt_gpu_failed();
			return;
		}
		error = '';
		phase = 'loading';
		chosenTrack = track;
		generation = room.voice?.generation ?? 0;
		language = room.settings.transcriptionLanguage ?? 'fr';
		const instance = new BrowserSTT(
			language as 'fr' | 'en' | 'auto',
			{
				ready: () => {
					if (engine !== instance || !track || !ready) return;
					phase = 'starting';
					request = crypto.randomUUID();
					admissionTimer = setTimeout(() => stop(m.browser_stt_failed()), 15000);
					if (!send('transcript.start', { requestId: request, generation, consent: true }))
						stop(m.browser_stt_failed());
				},
				segment: (value) => {
					if (engine === instance && lease && ready && track === chosenTrack) {
						if (!send('transcript.publish', { ...value, sessionId: lease.sessionId, generation }))
							stop(m.browser_stt_failed());
					}
				},
				failure: (reason) => {
					if (engine === instance)
						stop(
							reason === 'slow'
								? m.browser_stt_slow()
								: reason === 'gpu'
									? m.browser_stt_gpu_failed()
									: m.browser_stt_failed()
						);
				}
			},
			model,
			(useGpu ? 'webgpu' : 'wasm') as BrowserSTTBackend
		);
		engine = instance;
		instance.load();
	}
	$effect(() => {
		if (
			phase !== 'off' &&
			(!ready ||
				!track ||
				track !== chosenTrack ||
				room.role === 'spectator' ||
				!room.settings.transcriptionEnabled ||
				room.voice?.generation !== generation ||
				(room.settings.transcriptionLanguage ?? 'fr') !== language)
		)
			stop();
	});
	$effect(() => {
		if (!session || session.roomId !== room.roomId || session.sessionId === handledSession) return;
		handledSession = session.sessionId;
		if (
			!request ||
			session.requestId !== request ||
			session.generation !== generation ||
			!track ||
			!engine
		) {
			if (ready) send('transcript.stop', session); // Retire a late acknowledgement after cancellation.
			return;
		}
		clearTimeout(admissionTimer);
		request = null;
		lease = session;
		phase = 'active';
		heartbeat = setInterval(() => {
			if (lease && ready) send('transcript.keepalive', lease);
		}, 5000);
		void engine.captureTrack(track);
	});
	$effect(() => {
		if (
			failure &&
			((request && failure.requestId === request) ||
				(lease && failure.requestId === lease.sessionId))
		)
			stop(m.browser_stt_failed());
	});
</script>

<div
	class="flex flex-wrap items-center gap-2 text-xs"
	data-testid="browser-stt-controls"
	data-state={phase}
>
	<button
		type="button"
		class="btn btn-sm btn-outline"
		data-testid="browser-stt-toggle"
		disabled={phase === 'off' &&
			(!supported || !track || !ready || !room.settings.transcriptionEnabled)}
		aria-pressed={phase !== 'off'}
		onclick={() => {
			if (phase !== 'off') stop();
			else consentOpen = true;
		}}>{phase !== 'off' ? m.browser_stt_stop() : m.browser_stt_enable()}</button
	>
	<span role="status"
		>{phase === 'loading'
			? m.browser_stt_loading()
			: phase === 'starting'
				? m.browser_stt_starting()
				: phase === 'active'
					? m.browser_stt_active({
							model:
								model === 'small'
									? 'Whisper small'
									: model === 'base'
										? 'Whisper base'
										: 'Whisper tiny',
							backend: useGpu ? 'WebGPU' : 'CPU'
						})
					: !supported
						? m.browser_stt_unsupported()
						: !track
							? m.browser_stt_needs_mic()
							: m.browser_stt_optional()}</span
	>
	{#if error}<span class="text-error" role="alert">{error}</span>{/if}
</div>
{#if consentOpen}<dialog
		bind:this={dialog}
		aria-labelledby="browser-stt-title"
		class="bg-base-100 m-auto max-w-md rounded-xl p-6 shadow-xl backdrop:bg-black/40"
		oncancel={() => {
			consentOpen = false;
		}}
	>
		<h2 id="browser-stt-title" class="mb-3 text-lg font-semibold">{m.browser_stt_enable()}</h2>
		<label class="mb-3 block text-sm">
			{m.browser_stt_model()}
			<select
				class="select select-bordered mt-1 w-full"
				data-testid="browser-stt-model"
				bind:value={model}
				onchange={() => {
					if (model === 'small') useGpu = true;
				}}
			>
				<option value="tiny">{m.browser_stt_model_tiny()}</option>
				<option value="base">{m.browser_stt_model_base()}</option>
				<option value="small" disabled={!gpuAvailable}>
					{m.browser_stt_model_small()}
				</option>
			</select>
		</label>
		<p class="mb-3 text-sm opacity-70">{m.browser_stt_model_hint()}</p>
		{#if gpuAvailable}
			<label class="mb-2 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					data-testid="browser-stt-webgpu"
					bind:checked={useGpu}
					disabled={model === 'small'}
				/>
				{m.browser_stt_webgpu()}
			</label>
			<p class="mb-3 text-sm opacity-70">{m.browser_stt_webgpu_hint()}</p>
		{/if}
		<p class="mb-3 text-sm">{m.browser_stt_consent({ size: downloadSize() })}</p>
		<p class="mb-4 text-sm opacity-70">{m.browser_stt_limits()}</p>
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-ghost"
				onclick={() => {
					consentOpen = false;
				}}>{m.cancel()}</button
			><button class="btn btn-primary" data-testid="browser-stt-confirm" onclick={begin}
				>{m.browser_stt_accept()}</button
			>
		</div>
	</dialog>{/if}
