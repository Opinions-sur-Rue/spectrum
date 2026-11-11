<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { toolbarMenu } from './toolbar-menu';
	import type { NoteModel } from './models';
	import { highlightParts, noteSnippet, searchNotes, textMatches } from './note-search';
	let { notes, select }: { notes: NoteModel[]; select: (note: NoteModel) => void } = $props();
	let menu = $state<HTMLDetailsElement>();
	let input = $state<HTMLInputElement>();
	let query = $state('');
	const results = $derived(searchNotes(notes, query));
	const snippets = $derived(
		new Map(
			results.map((note) => [
				note.id,
				textMatches(note.title, query) ? '' : noteSnippet(note, query)
			])
		)
	);
	function choose(note: NoteModel) {
		if (menu) menu.open = false;
		select(note);
	}
	function shortcut(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
		if (event.key.toLowerCase() !== 'k') return;
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (document.querySelector('dialog[open]')) return;
		event.preventDefault();
		if (menu?.open) input?.focus();
		else if (menu) menu.open = true;
	}
</script>

<svelte:window onkeydown={shortcut} />

<details
	bind:this={menu}
	class="relative"
	use:toolbarMenu
	ontoggle={async (event) => {
		if (event.currentTarget.open) {
			query = '';
			await tick();
			input?.focus();
		}
	}}
>
	<summary class="toolbar-summary" aria-label={m.ux_find_note()} title={m.ux_find_note()}
		><Icon name="list" /></summary
	>
	<div
		class="toolbar-popover bg-base-100 w-72 rounded-xl border p-3 shadow-xl"
		data-testid="note-navigator"
	>
		<h2 class="mb-2 text-sm font-semibold">{m.ux_find_note()}</h2>
		{#if notes.length}
			<form
				class="mb-2 flex items-center gap-1"
				onsubmit={(event) => {
					event.preventDefault();
					if (results[0]) choose(results[0]);
				}}
			>
				<input
					bind:this={input}
					class="input input-sm input-bordered min-w-0 flex-1"
					type="search"
					aria-label={m.ux_note_search()}
					aria-keyshortcuts="Control+K Meta+K"
					placeholder={m.ux_note_search_hint()}
					bind:value={query}
				/>
				{#if query}<button
						class="btn btn-sm btn-ghost"
						type="button"
						aria-label={m.ux_note_search_clear()}
						onclick={() => {
							query = '';
							input?.focus();
						}}>×</button
					>{/if}
			</form>
			<p role="status" class="mb-2 text-xs opacity-70">
				{m.ux_note_search_count({ count: results.length, total: notes.length })}
			</p>
			{#if results.length}<ul class="space-y-1">
					{#each results as note (note.id)}<li>
							<button
								type="button"
								class="hover:bg-base-200 w-full rounded-lg px-2 py-2.5 text-left text-sm break-words focus-visible:outline-2"
								onclick={() => choose(note)}
							>
								<span class="block"
									>{#each highlightParts(note.title, query) as part, index (index)}{#if part.match}<mark
												class="bg-warning/50 text-inherit">{part.text}</mark
											>{:else}{part.text}{/if}{/each}</span
								>
								{#if snippets.get(note.id)}<span class="mt-1 block text-xs opacity-70"
										>{#each highlightParts(snippets.get(note.id) ?? '', query) as part, index (index)}{#if part.match}<mark
													class="bg-warning/50 text-inherit">{part.text}</mark
												>{:else}{part.text}{/if}{/each}</span
									>{/if}
							</button>
						</li>{/each}
				</ul>{:else}<p class="text-sm">{m.ux_note_search_empty()}</p>{/if}
		{:else}<p class="text-sm">{m.ux_find_note_empty()}</p>{/if}
	</div>
</details>
