<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { toolbarMenu } from './toolbar-menu';
	import type { NoteModel } from './models';
	let { notes, select }: { notes: NoteModel[]; select: (note: NoteModel) => void } = $props();
	let menu: HTMLDetailsElement;
</script>

<details bind:this={menu} class="relative" use:toolbarMenu>
	<summary class="toolbar-summary" aria-label={m.ux_find_note()} title={m.ux_find_note()}
		><Icon name="list" /></summary
	>
	<div
		class="toolbar-popover bg-base-100 w-72 rounded-xl border p-3 shadow-xl"
		data-testid="note-navigator"
	>
		<h2 class="mb-2 text-sm font-semibold">{m.ux_find_note()}</h2>
		{#if notes.length}<ul class="space-y-1">
				{#each notes as note (note.id)}<li>
						<button
							type="button"
							class="hover:bg-base-200 w-full rounded-lg px-2 py-3 text-left text-sm break-words focus-visible:outline-2"
							onclick={() => {
								menu.open = false;
								select(note);
							}}>{note.title}</button
						>
					</li>{/each}
			</ul>{:else}<p class="text-sm">{m.ux_find_note_empty()}</p>{/if}
	</div>
</details>
