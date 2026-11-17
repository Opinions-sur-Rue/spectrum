<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { loadPersonalNotes, savePersonalNotes } from './personal-notes';
	let { roomId }: { roomId: string } = $props();
	let text = $state('');
	let ownedRoom = '';
	let saved = $state(false);
	let unavailable = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function flush(room: string, value: string) {
		clearTimeout(timer);
		if (!room) return;
		unavailable = !savePersonalNotes(room, value);
	}
	// Switching rooms must save the previous room's notes and never display or
	// overwrite them under the new room's key.
	$effect(() => {
		const next = roomId;
		if (ownedRoom && ownedRoom !== next) flush(ownedRoom, text);
		ownedRoom = next;
		text = loadPersonalNotes(next);
		saved = false;
		unavailable = false;
	});
	function type() {
		clearTimeout(timer);
		const room = ownedRoom;
		saved = false;
		timer = setTimeout(() => {
			flush(room, text);
			saved = !unavailable;
		}, 400);
	}
	onMount(() => {
		const discard = () => flush(ownedRoom, text);
		window.addEventListener('pagehide', discard);
		return () => {
			window.removeEventListener('pagehide', discard);
			discard();
		};
	});
</script>

<section class="personal-notes flex h-full min-h-0 flex-col gap-2 p-4" data-testid="personal-notes">
	<p class="flex items-start gap-2 text-xs opacity-70">
		<Icon name="lock" />
		<span>{m.personal_notes_private()}</span>
	</p>
	<textarea
		class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none"
		placeholder={m.personal_notes_placeholder()}
		aria-label={m.personal_notes_label()}
		bind:value={text}
		oninput={type}
		data-testid="personal-notes-input"
	></textarea>
	<div class="flex items-center justify-between gap-2 text-xs">
		<span role="status" data-testid="personal-notes-status">
			{#if unavailable}{m.personal_notes_unavailable()}{:else if saved}
				{m.personal_notes_saved()}
			{/if}
		</span>
		{#if text}<IconButton
				icon="trash"
				label={m.personal_notes_clear()}
				data-testid="personal-notes-clear"
				onclick={() => {
					text = '';
					flush(ownedRoom, '');
					saved = false;
					unavailable = false;
				}}
			/>{/if}
	</div>
</section>
