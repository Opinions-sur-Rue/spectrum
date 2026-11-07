<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { toolbarMenu } from './toolbar-menu';
	import type { NoteModel } from './models';
	let {
		notes,
		ready,
		send,
		select
	}: {
		notes: NoteModel[];
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
		select: (note: NoteModel) => void;
	} = $props();
	let menu: HTMLDetailsElement;
</script>

<details bind:this={menu} class="relative z-40" use:toolbarMenu>
	<summary
		class="toolbar-summary"
		aria-label={m.v2_pending({ count: String(notes.length) })}
		title={m.ux_pending_notes()}
		><Icon name="review" /><span class="text-xs">{notes.length}</span></summary
	>
	<div class="toolbar-popover bg-base-100 w-80 overflow-y-auto rounded-xl border p-4 shadow-xl">
		<h2 class="mb-3 text-sm font-semibold">{m.ux_pending_notes()}</h2>
		<ul class="space-y-2">
			{#each notes as note (note.id)}<li class="flex items-center gap-2 text-sm">
					<button
						class="min-w-0 flex-1 truncate text-left"
						title={m.v2_go_note()}
						onclick={() => {
							select(note);
							menu.open = false;
						}}>{note.title}</button
					><IconButton
						icon="check"
						label={m.v2_approve_note({ name: note.title })}
						disabled={!ready}
						onclick={() => send('note.moderate', { noteId: note.id, decision: 'approved' })}
					/><IconButton
						icon="cancel"
						label={m.v2_reject_note({ name: note.title })}
						disabled={!ready}
						onclick={() => send('note.moderate', { noteId: note.id, decision: 'rejected' })}
					/>
				</li>{/each}
		</ul>
	</div>
</details>
