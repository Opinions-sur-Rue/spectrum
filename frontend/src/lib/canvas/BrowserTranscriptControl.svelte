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
		type BrowserSTTBackend,
		type STTLoadProgress
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
		active = $bindable(false),
		// eslint-disable-next-line no-useless-assignment -- Bindable summary for closed audio menu.
		statusText = $bindable('')
	}: {
		room: RoomState;
		track: MediaStreamTrack | null;
		ready: boolean;
		session: BrowserTranscriptSession | null;
		failure: BrowserTranscriptFailure | null;
		send: (op: string, payload: unknown) => boolean;
		active?: boolean;
		statusText?: string;
	} = $props();
	let supported = $state(false);
	let phase = $state<'off' | 'loading' | 'starting' | 'active'>('off');
	let consentOpen = $state(false);
	let model = $state<BrowserSTTModel>('parakeet');
	let useGpu = $state(false);
	let gpuAvailable = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let error = $state('');
	let progress = $state<STTLoadProgress | null>(null);
	let cacheUnavailable = $state(false);
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
		statusText =
			phase === 'loading'
				? progress?.phase === 'download' && progress.total > 0
					? m.browser_stt_progress_short({
							percent: Math.floor((progress.loaded / progress.total) * 100)
						})
					: progress?.phase === 'cache'
						? m.browser_stt_cache_short()
						: m.browser_stt_initializing_short()
				: phase === 'starting'
					? m.browser_stt_starting()
					: phase === 'active'
						? m.browser_stt_active_short()
						: '';
	});
	function loadingDescription() {
		if (!progress) return m.browser_stt_loading();
		if (progress.phase === 'cache') return m.browser_stt_cache_short();
		if (progress.phase === 'initializing') return m.browser_stt_initializing_short();
		if (!progress.total) return m.browser_stt_download_waiting();
		const values = {
			loaded: (progress.loaded / 1000000).toFixed(1),
			total: (progress.total / 1000000).toFixed(1),
			percent: Math.floor((progress.loaded / progress.total) * 100)
		};
		return progress.fileOnly ? m.browser_stt_download_file(values) : m.browser_stt_download(values);
	}
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
		if (model === 'parakeet') return '225';
		return useGpu ? '180' : '110';
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
		progress = null;
		chosenTrack = null;
		error = message;
	}
	function begin() {
		consentOpen = false;
		if (!track || !supported || !ready) return;
		if (model === 'parakeet' && (room.settings.transcriptionLanguage ?? 'fr') === 'auto') {
			error = m.browser_stt_parakeet_hint();
			return;
		}
		error = '';
		progress = null;
		cacheUnavailable = false;
		phase = 'loading';
		chosenTrack = track;
		generation = room.voice?.generation ?? 0;
		language = room.settings.transcriptionLanguage ?? 'fr';
		const instance = new BrowserSTT(
			language as 'fr' | 'en' | 'auto',
			{
				progress: (value) => {
					if (engine === instance) {
						progress = value;
						if (value.cacheAvailable === false) cacheUnavailable = true;
					}
				},
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
									: reason === 'download'
										? m.browser_stt_download_failed()
										: reason === 'assets'
											? m.browser_stt_assets_failed()
											: reason === 'engine'
												? m.browser_stt_engine_failed()
												: m.browser_stt_failed()
						);
				}
			},
			model,
			(useGpu && model !== 'parakeet' ? 'webgpu' : 'wasm') as BrowserSTTBackend
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
			else {
				// Pick a supported visible choice before asking consent, never at runtime.
				if (model === 'parakeet' && room.settings.transcriptionLanguage === 'auto') model = 'base';
				consentOpen = true;
			}
		}}>{phase !== 'off' ? m.browser_stt_stop() : m.browser_stt_enable()}</button
	>
	<span role="status"
		>{phase === 'loading'
			? loadingDescription()
			: phase === 'starting'
				? m.browser_stt_starting()
				: phase === 'active'
					? m.browser_stt_active({
							model: model === 'parakeet' ? 'Parakeet Redux w2a8' : 'Whisper base',
							backend: useGpu && model !== 'parakeet' ? 'WebGPU' : 'CPU'
						})
					: !supported
						? m.browser_stt_unsupported()
						: !track
							? m.browser_stt_needs_mic()
							: m.browser_stt_optional()}</span
	>
	{#if phase === 'loading'}
		{#if progress?.phase === 'download' && progress.total > 0}
			<progress
				class="progress progress-primary w-full"
				data-testid="browser-stt-progress"
				aria-label={m.browser_stt_progress_label()}
				aria-valuetext={loadingDescription()}
				max="100"
				value={Math.floor((progress.loaded / progress.total) * 100)}
			></progress>
		{:else}
			<progress
				class="progress progress-primary w-full"
				data-testid="browser-stt-progress"
				aria-label={m.browser_stt_progress_label()}
				aria-valuetext={loadingDescription()}
				max="100"
			></progress>
		{/if}
	{/if}
	{#if error}<span class="text-error" role="alert">{error}</span>{/if}
	{#if cacheUnavailable}<p class="text-xs opacity-70">{m.browser_stt_cache_unavailable()}</p>{/if}
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
					if (model === 'parakeet') useGpu = false;
				}}
			>
				<option value="parakeet" disabled={room.settings.transcriptionLanguage === 'auto'}>
					{m.browser_stt_model_parakeet()}
				</option>
				<option value="base">{m.browser_stt_model_base()}</option>
			</select>
		</label>
		<p class="mb-3 text-sm opacity-70">{m.browser_stt_model_hint()}</p>
		{#if model === 'parakeet'}
			<p class="mb-3 text-sm opacity-70">{m.browser_stt_parakeet_hint()}</p>
			<p class="mb-3 text-xs opacity-70">
				Parakeet Redux: moondream / NVIDIA; ONNX: Olicorne.
				<a class="link" href="https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-redux-onnx"
					>CC-BY-4.0</a
				>
			</p>
		{/if}
		{#if gpuAvailable}
			<label class="mb-2 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					data-testid="browser-stt-webgpu"
					bind:checked={useGpu}
					disabled={model === 'parakeet'}
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
