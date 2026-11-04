<script lang="ts">
	import { onMount } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import {
		VoiceConnection,
		type VoiceCredentials,
		type VoiceError,
		type VoiceConnectionStatus
	} from './voice-connection';
	import type { RoomState } from './room-client';
	let {
		room,
		ready,
		credentials,
		failure,
		invalidation,
		send
	}: {
		room: RoomState;
		ready: boolean;
		credentials: VoiceCredentials | null;
		failure: VoiceError | null;
		invalidation: number;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let audio: HTMLDivElement;
	let connection = $state<VoiceConnection | null>(null);
	let wanted = $state(false);
	let status = $state<VoiceConnectionStatus>('idle');
	let microphone = $state(false);
	let busy = $state(false);
	let playbackBlocked = $state(false);
	let remoteTracks = $state(0);
	let request = $state<string | null>(null);
	let error = $state('');
	let signature = '';
	let granted = $state(false);
	const onStage = $derived(room.role !== 'spectator');
	const connected = $derived(status === 'connected');

	onMount(() => {
		const instance = new VoiceConnection(audio, {
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
			}
		});
		connection = instance;
		return () => {
			connection = null;
			void instance.disconnect();
		};
	});
	function join() {
		if (!ready || !connection) return;
		error = '';
		granted = false;
		request = crypto.randomUUID();
		if (!send('voice.join', { requestId: request })) {
			request = null;
			status = 'error';
			error = 'Connection unavailable';
		}
	}
	$effect(() => {
		if (!connection) return;
		const next = `${room.roomId}:${room.role}:${room.voice?.generation}:${invalidation}:${ready}`;
		if (signature === next) return;
		signature = next;
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
		void connection.connect(credentials);
	});
	$effect(() => {
		if (failure && failure.requestId === request) {
			request = null;
			status = 'error';
			error = failure.message;
		}
	});
</script>

<div
	class="flex items-center gap-1"
	data-testid="voice-controls"
	data-status={status}
	data-remote-tracks={remoteTracks}
	data-microphone={microphone}
>
	<IconButton
		icon="headphones"
		label={wanted ? 'Leave audio' : 'Join audio'}
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
	/>
	{#if wanted && onStage}<IconButton
			icon={microphone ? 'micOff' : 'mic'}
			label={microphone ? 'Mute microphone' : 'Enable microphone'}
			disabled={!connected || !granted || busy || !ready}
			aria-pressed={microphone}
			onclick={() => {
				if (onStage && granted) void connection?.toggleMicrophone();
			}}
		/>{/if}
	{#if wanted && playbackBlocked}<IconButton
			icon="speaker"
			label="Enable sound"
			onclick={() => {
				void connection?.enablePlayback();
			}}
		/>{/if}
	{#if wanted && (request || status === 'connecting' || status === 'reconnecting')}<span
			class="loading loading-spinner loading-xs"
			aria-label="Connecting audio"
		></span>{/if}
	{#if wanted && status === 'idle' && !request && ready}<IconButton
			icon="reset"
			label="Reconnect audio"
			onclick={join}
		/>{/if}
	{#if error}<span role="alert" class="text-error max-w-48 text-xs">{error}</span>{/if}
	<div bind:this={audio} class="hidden" aria-hidden="true"></div>
</div>
