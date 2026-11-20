<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RoomMember } from './room-client';
	import type { VoiceConnection } from './voice-connection';
	import Icon from '$lib/components/Icon.svelte';
	let {
		member,
		own,
		connection,
		speaking
	}: { member: RoomMember; own: boolean; connection: VoiceConnection | null; speaking: boolean } =
		$props();
	let volume = $derived(connection?.getVolume(member.id) ?? 1);
</script>

{#if speaking || (member.microphoneMuted && member.role !== 'spectator') || (connection && !own && member.role !== 'spectator')}<div
		class="member-audio flex w-full flex-wrap items-center gap-2"
	>
		{#if member.microphoneMuted && member.role !== 'spectator'}<span
				data-muted-member={member.id}
				class="text-xs"
				title={m.voice_resume_self_hint()}>{m.voice_muted_by_admin()}</span
			>{/if}
		{#if speaking}<span
				class="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] text-white"
				role="status"
				data-speaking-member={member.id}>{m.voice_speaking({ name: member.nickname })}</span
			>{/if}
		{#if connection && !own && member.role !== 'spectator'}
			<label class="ml-auto flex items-center gap-2 text-[10px]" title={m.voice_volume_hint()}
				><Icon name="speaker" /><input
					type="range"
					min="0"
					max="1"
					step="0.05"
					class="range range-xs w-20"
					aria-label={m.voice_volume({ name: member.nickname })}
					value={volume}
					oninput={(event) => {
						volume = Number(event.currentTarget.value);
						connection?.setVolume(member.id, volume);
					}}
				/><span class="w-7 text-right">{Math.round(volume * 100)}%</span></label
			>
		{/if}
	</div>{/if}

<style>
	.member-audio {
		min-width: 0;
	}
	.member-audio input {
		min-height: 32px;
		max-width: 5rem;
	}
	@media (pointer: coarse) {
		.member-audio input {
			min-height: 44px;
		}
	}
</style>
