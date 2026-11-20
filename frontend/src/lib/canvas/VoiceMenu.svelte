<script lang="ts">
	import { onMount, untrack } from 'svelte';
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
	import MicLevel from './MicLevel.svelte';
	import {
		audioInputOptions,
		loadMicDevice,
		saveMicDevice,
		type AudioInputOption
	} from './audio-inputs';
	import type { BrowserTranscriptSession, BrowserTranscriptFailure } from './browser-stt';
	import { toolbarMenu } from './toolbar-menu';
	import { pushToTalk } from './push-to-talk';
	import { roomErrorLabel } from './room-error-label';
	let {
		room,
		ready,
		credentials,
		failure,
		browserSession = null,
		browserFailure = null,
		invalidation,
		connection = $bindable(null),
		speakers = $bindable([]),
		localTrack = $bindable(null),
		remoteAudioTracks = $bindable({}),
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
		localTrack?: MediaStreamTrack | null;
		remoteAudioTracks?: Record<string, MediaStreamTrack>;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let audio: HTMLDivElement;
	let wanted = $state(false);
	let status = $state<VoiceConnectionStatus>('idle');
	let microphone = $state(false);
	let microphoneWanted = false;
	let restorePending = $state(false);
	let identity = '';
	let transcriptionPolicy = '';
	let busy = $state(false);
	let playbackBlocked = $state(false);
	let remoteTracks = $state(0);
	let request = $state<string | null>(null);
	let needsJoin = $state(false);
	let error = $state('');
	let localCaptions = $state(false);
	let captionStatus = $state('');
	let signature = '';
	let granted = $state(false);
	let consentOpen = $state(false);
	let consentDialog = $state<HTMLDialogElement>();
	let startAfterConsent = $state(false);
	let inputs = $state<AudioInputOption[]>([]);
	let deviceId = $state('');
	let pttMode = $state(false);
	let pttPressed = $state(false);
	let hold = $state(0);
	let attemptedHold = 0;
	function holdMicrophone(pressed: boolean) {
		pttPressed = pressed;
		microphoneWanted = false;
		restorePending = false;
		if (pressed) hold++;
		else void connection?.disableMicrophone();
	}
	function changePttMode(enabled: boolean) {
		pttMode = enabled;
		holdMicrophone(false);
	}
	$effect(() => {
		if (canHold && pttPressed && !busy && !microphone && connection && attemptedHold !== hold) {
			attemptedHold = hold;
			untrack(() => {
				void connection?.toggleMicrophone();
			});
		}
	});
	const transcribing = $derived(
		!!room.transcription?.available &&
			room.transcription.mode !== 'browser' &&
			!!room.settings.transcriptionEnabled
	);
	const onStage = $derived(room.role !== 'spectator');
	const moderationMuted = $derived(
		room.members.some((member) => member.id === room.userId && member.microphoneMuted)
	);
	const connected = $derived(status === 'connected');
	const canHold = $derived(
		pttMode && wanted && onStage && connected && granted && ready && !moderationMuted
	);
	$effect(() => {
		if (moderationMuted && connection) {
			microphoneWanted = false;
			startAfterConsent = false;
			restorePending = false;
			untrack(() => {
				void connection?.setPublishAllowed(false);
			});
		}
	});
	// Turn boundaries are self-reported for the shared per-member totals. The
	// server still validates that the caller may publish, so this only adds data.
	let reportedSpeaking = false;
	$effect(() => {
		const speaking = wanted && connected && speakers.includes(room.userId);
		if (speaking === reportedSpeaking) return;
		reportedSpeaking = speaking;
		send('voice.speaking', { speaking });
	});
	$effect(() => () => {
		if (!reportedSpeaking) return;
		reportedSpeaking = false;
		send('voice.speaking', { speaking: false });
	});
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
							: moderationMuted
								? m.voice_muted_by_admin()
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
			permissions: (allowed) => {
				granted = allowed;
			},
			localTrack: (track) => {
				localTrack = track;
			},
			remoteAudioTracks: (tracks) => {
				remoteAudioTracks = tracks;
			},
			status: (value) => {
				status = value;
			},
			disconnected: () => {
				needsJoin = true;
			},
			microphone: (enabled, working) => {
				microphone = enabled;
				if (enabled && !pttMode) microphoneWanted = true;
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
		deviceId = loadMicDevice() ?? '';
		void instance.setMicrophoneDevice(deviceId || null);
		return () => {
			connection = null;
			void instance.disconnect();
		};
	});
	function join(consent = false, resume = false) {
		if (!ready || !connection) return;
		needsJoin = false;
		error = '';
		granted = false;
		request = crypto.randomUUID();
		if (
			!send(resume ? 'voice.resume' : 'voice.join', {
				requestId: request,
				transcriptionConsent: consent
			})
		) {
			request = null;
			status = 'error';
			error = m.ux_connection_unavailable();
		}
	}
	$effect(() => {
		if (!connection) return;
		const nextPolicy = transcribing ? `on:${room.settings.transcriptionLanguage}` : 'off';
		const next = `${room.roomId}:${room.userId}:${room.voice?.generation}:${invalidation}:${nextPolicy}`;
		if (signature === next) return;
		signature = next;
		const nextIdentity = `${room.roomId}:${room.userId}`;
		if (identity !== nextIdentity || !onStage || transcriptionPolicy !== nextPolicy)
			microphoneWanted = false;
		identity = nextIdentity;
		transcriptionPolicy = nextPolicy;
		consentOpen = false;
		startAfterConsent = false;
		restorePending = false;
		request = null;
		granted = false;
		needsJoin = true;
		void connection.disconnect();
	});
	$effect(() => {
		if (!onStage && connection) {
			microphoneWanted = false;
			restorePending = false;
			startAfterConsent = false;
			untrack(() => {
				void connection?.setPublishAllowed(false);
			});
		}
	});
	// Spectrum's WebSocket and LiveKit have independent lifetimes. A lost
	// request can be retried once Spectrum is ready, without cutting live audio.
	$effect(() => {
		if (!ready) {
			if (request) needsJoin = true;
			request = null;
			return;
		}
		if (wanted && connection && !request && needsJoin) untrack(() => join());
	});
	$effect(() => {
		if (
			!connection ||
			!credentials ||
			credentials.roomId !== room.roomId ||
			credentials.requestId !== request ||
			!wanted ||
			!ready
		)
			return;
		if (credentials.generation < (room.voice?.generation ?? 0)) {
			join();
			return;
		}
		if (!onStage && credentials.canPublish) {
			join();
			return;
		}
		request = null;
		granted = credentials.canPublish;
		const generation = credentials.generation;
		const connectingSignature = signature;
		const instance = connection;
		void instance.connect(credentials).then(() => {
			if (
				(startAfterConsent || microphoneWanted) &&
				wanted &&
				onStage &&
				granted &&
				status === 'connected' &&
				generation === room.voice?.generation &&
				signature === connectingSignature
			) {
				startAfterConsent = false;
				restorePending = true;
			}
		});
	});
	$effect(() => {
		if (
			restorePending &&
			ready &&
			connected &&
			onStage &&
			granted &&
			connection &&
			!moderationMuted
		) {
			restorePending = false;
			// One attempt per rejoin: a denied permission must not cause a loop.
			if (!microphone && !busy)
				untrack(() => {
					void connection?.toggleMicrophone();
				});
		}
	});
	$effect(() => {
		if (failure && failure.requestId === request) {
			request = null;
			startAfterConsent = false;
			status = 'error';
			error = roomErrorLabel(failure.message);
		}
	});
	async function refreshInputs() {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			inputs = audioInputOptions(devices);
		} catch {
			inputs = [];
		}
	}
	$effect(() => {
		if (!wanted || !onStage) return;
		void refreshInputs();
		const media = navigator.mediaDevices;
		media?.addEventListener('devicechange', refreshInputs);
		return () => media?.removeEventListener('devicechange', refreshInputs);
	});
	function chooseDevice(value: string) {
		deviceId = value;
		saveMicDevice(value || null);
		void connection?.setMicrophoneDevice(value || null).then(refreshInputs);
	}
</script>

<div
	class="flex min-w-0 flex-wrap items-center gap-2"
	class:ptt-compact={pttMode && wanted && onStage}
	data-testid="voice-controls"
	data-status={status}
	data-remote-tracks={remoteTracks}
	data-spectrum-tracks={Object.keys(remoteAudioTracks).length}
	data-microphone={microphone}
>
	<button
		type="button"
		class="btn btn-sm gap-2"
		data-testid="audio-toggle"
		aria-label={wanted ? m.ux_leave_audio() : m.ux_join_audio()}
		title={wanted ? m.ux_leave_audio() : m.ux_join_audio()}
		disabled={!ready}
		aria-pressed={wanted}
		onclick={() => {
			wanted = !wanted;
			if (wanted) join();
			else {
				microphoneWanted = false;
				request = null;
				granted = false;
				error = '';
				void connection?.disconnect();
			}
		}}
		><Icon name="headphones" /><span class="audio-label"
			>{wanted ? m.ux_leave_audio() : m.ux_join_audio()}</span
		></button
	>
	{#if wanted && onStage && (!pttMode || (transcribing && !granted) || moderationMuted)}<IconButton
			icon={microphone ? 'micOff' : 'mic'}
			label={moderationMuted
				? m.voice_resume_self()
				: microphone
					? m.ux_mute_microphone()
					: m.ux_enable_microphone()}
			disabled={!connected || (!granted && !transcribing && !moderationMuted) || busy || !ready}
			aria-pressed={microphone}
			onclick={() => {
				if (!onStage) return;
				if (transcribing && !granted) consentOpen = true;
				else if (moderationMuted) {
					startAfterConsent = !pttMode;
					join(false, true);
				} else if (granted) {
					if (microphone) microphoneWanted = false;
					void connection?.toggleMicrophone();
				}
			}}
		/>{/if}
	{#if wanted && onStage && pttMode}<button
			type="button"
			class="btn btn-sm ptt-button"
			class:btn-primary={pttPressed}
			data-testid="push-to-talk"
			aria-label={m.ptt_hold()}
			title={m.ptt_hint()}
			aria-keyshortcuts="Space"
			aria-pressed={pttPressed}
			aria-describedby="push-to-talk-hint"
			disabled={!canHold}
			use:pushToTalk={{ enabled: canHold, change: holdMicrophone }}
			><Icon name="mic" /><span class="ptt-label">{m.ptt_hold()}</span><span class="ptt-short"
				>{m.ptt_hold_short()}</span
			></button
		>
		<span id="push-to-talk-hint" class="sr-only">{m.ptt_hint()}</span>
	{/if}
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
	{#if localCaptions}<span
			class="max-w-36 truncate text-xs"
			role="status"
			aria-live="polite"
			title={captionStatus}
			data-testid="browser-stt-summary">{captionStatus}</span
		>{/if}
	{#if onStage && (wanted || room.transcription?.mode === 'browser')}<details
			class="relative"
			use:toolbarMenu
		>
			<summary
				class="toolbar-summary"
				data-testid="audio-options"
				aria-label={m.ux_audio_options()}
				title={m.ux_audio_options()}
			>
				<Icon name="more" /><span class="toolbar-label hidden sm:inline"
					>{m.ux_audio_options()}</span
				>
			</summary>
			<div
				class="experimental-audio-panel toolbar-popover bg-base-100 w-80 space-y-3 rounded-xl border p-4 shadow-xl"
			>
				{#if wanted}
					<label class="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							data-testid="push-to-talk-mode"
							checked={pttMode}
							onchange={(event) => changePttMode(event.currentTarget.checked)}
						/>
						{m.ptt_mode()}
					</label>
					{#if pttMode}<p class="text-xs opacity-70">{m.ptt_hint()}</p>{/if}
					<label class="block text-xs"
						>{m.ux_mic_device()}
						<select
							class="select select-sm mt-1 w-full"
							data-testid="mic-device"
							value={deviceId}
							onchange={(event) => chooseDevice(event.currentTarget.value)}
						>
							<option value="">{m.ux_mic_default()}</option>
							{#each inputs as input, index (input.id)}<option value={input.id}
									>{input.label || m.ux_mic_fallback({ number: index + 1 })}</option
								>{/each}
						</select>
					</label>
					{#if inputs.some((input) => !input.label)}<p class="text-xs opacity-70">
							{m.ux_mic_permission()}
						</p>{/if}
					{#if microphone}<MicLevel track={localTrack} />{:else}<p class="text-xs opacity-70">
							{m.ux_mic_prompt()}
						</p>{/if}
				{/if}
				{#if room.transcription?.mode === 'browser'}
					<div class:border-t={wanted} class:pt-3={wanted} class="space-y-3">
						<p class="text-xs">{m.ux_experimental_transcription()}</p>
						<BrowserTranscriptControl
							{room}
							track={localTrack}
							{ready}
							session={browserSession}
							failure={browserFailure}
							{send}
							bind:active={localCaptions}
							bind:statusText={captionStatus}
						/>
					</div>
				{/if}
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
					startAfterConsent = !pttMode;
					join(true, moderationMuted);
				}}>{pttMode ? m.ptt_consent_accept() : m.ux_consent_accept()}</button
			>
		</div>
	</dialog>
{/if}

<style>
	.ptt-button {
		min-height: 44px;
		touch-action: none;
		user-select: none;
	}
	.ptt-short {
		display: none;
	}
	@media (max-width: 359px) {
		.ptt-compact .audio-label {
			display: none;
		}
		.ptt-compact .voice-summary {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.ptt-label {
			display: none;
		}
		.ptt-short {
			display: inline;
		}
	}
	.voice-summary {
		font-size: var(--v2-text-xs);
		opacity: 0.65;
		max-width: 10rem;
	}
	.voice-summary.microphone-on {
		/* Keep a green tint but anchor contrast to the theme's readable text colour. */
		color: color-mix(in oklab, var(--color-success) 30%, var(--color-base-content));
		opacity: 1;
		font-weight: 600;
	}
	@media (max-width: 639px) {
		.voice-summary {
			font-size: var(--v2-text-2xs);
			max-width: 7rem;
		}
	}
</style>
