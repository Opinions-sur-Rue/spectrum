<script lang="ts">
	import { onMount } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import {
		VoiceConnection,
		type VoiceCredentials,
		type VoiceError,
		type VoiceConnectionStatus
	} from './voice-connection';
	import type { RoomState } from './room-client';
	import BrowserTranscriptControl from './BrowserTranscriptControl.svelte';
	import type { BrowserTranscriptSession, BrowserTranscriptFailure } from './browser-stt';
	import { toolbarMenu } from './toolbar-menu';
	let {
		room,
		ready,
		credentials,
		failure,
		browserSession = null,
		browserFailure = null,
		invalidation,
		connection = $bindable(null),
		// eslint-disable-next-line no-useless-assignment -- Bindable output consumed by the parent.
		speakers = $bindable([]),
		send
	}: {
		room: RoomState;
		ready: boolean;
		credentials: VoiceCredentials | null;
		failure: VoiceError | null;
		browserSession?: BrowserTranscriptSession | null;
		browserFailure?: BrowserTranscriptFailure | null;
		invalidation: number;
		connection?: VoiceConnection | null;
		speakers?: string[];
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let audio: HTMLDivElement;
	let localTrack = $state.raw<MediaStreamTrack | null>(null);
	let wanted = $state(false);
	let status = $state<VoiceConnectionStatus>('idle');
	let microphone = $state(false);
	let busy = $state(false);
	let playbackBlocked = $state(false);
	let remoteTracks = $state(0);
	let request = $state<string | null>(null);
	let error = $state('');
	let localCaptions = $state(false);
	let signature = '';
	let granted = $state(false);
	let consentOpen = $state(false);
	let consentDialog = $state<HTMLDialogElement>();
	let startAfterConsent = $state(false);
	const transcribing = $derived(
		!!room.transcription?.available &&
			room.transcription.mode !== 'browser' &&
			!!room.settings.transcriptionEnabled
	);
	const onStage = $derived(room.role !== 'spectator');
	const connected = $derived(status === 'connected');
	const summary = $derived(
		!wanted
			? m.ux_audio_off()
			: request || status === 'connecting' || status === 'reconnecting'
				? m.ux_audio_connecting()
				: status === 'error'
					? m.ux_audio_error()
					: connected
						? !onStage
							? m.ux_audio_listen_only()
							: busy
								? m.ux_audio_permission()
								: microphone
									? m.ux_microphone_on()
									: m.ux_microphone_off()
						: m.ux_audio_off()
	);
	$effect(() => {
		if (consentOpen && consentDialog && !consentDialog.open) consentDialog.showModal();
	});

	onMount(() => {
		const instance = new VoiceConnection(audio, {
			localTrack: (track) => {
				localTrack = track;
			},
			status: (value) => {
				status = value;
			},
			microphone: (enabled, working) => {
				microphone = enabled;
				busy = working;
			},
			playbackBlocked: (value) => {
				playbackBlocked = value;
			},
			remoteTracks: (value) => {
				remoteTracks = value;
			},
			error: (value) => {
				error = value;
			},
			speakers: (value) => {
				speakers = value;
			}
		});
		connection = instance;
		return () => {
			connection = null;
			void instance.disconnect();
		};
	});
	function join(consent = false) {
		if (!ready || !connection) return;
		error = '';
		granted = false;
		request = crypto.randomUUID();
		if (!send('voice.join', { requestId: request, transcriptionConsent: consent })) {
			request = null;
			status = 'error';
			error = m.ux_connection_unavailable();
		}
	}
	$effect(() => {
		if (!connection) return;
		const next = `${room.roomId}:${room.role}:${room.voice?.generation}:${invalidation}:${ready}`;
		if (signature === next) return;
		signature = next;
		consentOpen = false;
		startAfterConsent = false;
		request = null;
		granted = false;
		void connection.disconnect();
		if (wanted && ready) join();
	});
	$effect(() => {
		if (!connection || !credentials || credentials.requestId !== request || !wanted || !ready)
			return;
		if (credentials.generation < (room.voice?.generation ?? 0)) {
			join();
			return;
		}
		request = null;
		granted = credentials.canPublish;
		const generation = credentials.generation;
		const instance = connection;
		void instance.connect(credentials).then(() => {
			if (
				startAfterConsent &&
				wanted &&
				ready &&
				onStage &&
				granted &&
				status === 'connected' &&
				generation === room.voice?.generation
			) {
				startAfterConsent = false;
				void instance.toggleMicrophone();
			}
		});
	});
	$effect(() => {
		if (failure && failure.requestId === request) {
			request = null;
			startAfterConsent = false;
			status = 'error';
			error = failure.message;
		}
	});
</script>

<div
	class="flex min-w-0 flex-wrap items-center gap-2"
	data-testid="voice-controls"
	data-status={status}
	data-remote-tracks={remoteTracks}
	data-microphone={microphone}
>
	<button
		type="button"
		class="btn btn-sm gap-2"
		data-testid="audio-toggle"
		aria-label={wanted ? m.ux_leave_audio() : m.ux_join_audio()}
		disabled={!ready}
		aria-pressed={wanted}
		onclick={() => {
			wanted = !wanted;
			if (wanted) join();
			else {
				request = null;
				granted = false;
				error = '';
				void connection?.disconnect();
			}
		}}
		><Icon name="headphones" /><span>{wanted ? m.ux_leave_audio() : m.ux_join_audio()}</span
		></button
	>
	{#if wanted && onStage}<IconButton
			icon={microphone ? 'micOff' : 'mic'}
			label={microphone ? m.ux_mute_microphone() : m.ux_enable_microphone()}
			disabled={!connected || (!granted && !transcribing) || busy || !ready}
			aria-pressed={microphone}
			onclick={() => {
				if (!onStage) return;
				if (transcribing && !granted) consentOpen = true;
				else if (granted) void connection?.toggleMicrophone();
			}}
		/>{/if}
	{#if wanted && playbackBlocked}<IconButton
			icon="speaker"
			label={m.ux_enable_sound()}
			onclick={() => {
				void connection?.enablePlayback();
			}}
		/>{/if}
	{#if wanted && (request || status === 'connecting' || status === 'reconnecting')}<span
			class="loading loading-spinner loading-xs"
			aria-label={m.ux_connecting_audio()}
		></span>{/if}
	{#if wanted && (status === 'idle' || status === 'error') && !request && ready}<IconButton
			icon="reset"
			label={m.ux_reconnect_audio()}
			onclick={() => join()}
		/>{/if}
	{#if error}<span role="alert" class="text-error max-w-48 text-xs">{error}</span>{/if}
	<span
		class="voice-summary"
		class:microphone-on={microphone}
		role="status"
		aria-live="polite"
		data-testid="voice-summary">{summary}</span
	>
	<div bind:this={audio} class="hidden" aria-hidden="true"></div>
	{#if onStage && room.transcription?.mode === 'browser'}<details class="relative" use:toolbarMenu>
			<summary
				class="toolbar-summary"
				data-testid="audio-options"
				aria-label={m.ux_audio_options()}
			>
				<Icon name="more" /><span class="text-xs"
					>{localCaptions ? m.ux_experimental_transcription_active() : m.ux_audio_options()}</span
				>
			</summary>
			<div
				class="experimental-audio-panel toolbar-popover bg-base-100 w-80 space-y-3 rounded-xl border p-4 shadow-xl"
			>
				<p class="text-xs">{m.ux_experimental_transcription()}</p>
				<BrowserTranscriptControl
					{room}
					track={localTrack}
					{ready}
					session={browserSession}
					failure={browserFailure}
					{send}
					bind:active={localCaptions}
				/>
			</div>
		</details>{/if}
</div>

{#if consentOpen}
	<dialog
		bind:this={consentDialog}
		oncancel={() => {
			consentOpen = false;
		}}
		aria-labelledby="transcription-consent-title"
		class="bg-base-100 m-auto max-w-md rounded-lg p-6 shadow-xl backdrop:bg-black/40"
	>
		<h2 id="transcription-consent-title" class="mb-3 text-lg font-semibold">
			{m.ux_consent_title()}
		</h2>
		<p class="mb-3">
			{m.ux_consent_body()}
		</p>
		<p class="mb-4 text-sm">
			{m.ux_consent_privacy()}
		</p>
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-ghost"
				onclick={() => {
					consentOpen = false;
				}}>{m.ux_consent_cancel()}</button
			>
			<button
				class="btn btn-primary"
				onclick={() => {
					consentOpen = false;
					startAfterConsent = true;
					join(true);
				}}>{m.ux_consent_accept()}</button
			>
		</div>
	</dialog>
{/if}

<style>
	.voice-summary {
		font-size: 11px;
		opacity: 0.65;
		max-width: 10rem;
	}
	.voice-summary.microphone-on {
		color: var(--color-success);
		opacity: 1;
		font-weight: 600;
	}
	@media (max-width: 639px) {
		.voice-summary {
			font-size: 10px;
			max-width: 7rem;
		}
	}
</style>
