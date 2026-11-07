<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ACTIVITY_HISTORY_LIMIT, type ActivityEntry } from './activity-state';
	import { activityLabel } from './activity-labels';
	let { entries, active = true }: { entries: ActivityEntry[]; active?: boolean } = $props();
	let sticky = $state(true);
	let log = $state<HTMLDivElement>();
	const newest = $derived(entries.at(-1)?.id ?? 0);
	$effect(() => {
		const sequence = newest;
		if (active && sticky && sequence)
			void tick().then(() => {
				if (log) log.scrollTop = log.scrollHeight;
			});
	});
	function time(at: number) {
		return new Intl.DateTimeFormat(getLocale(), {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(at);
	}
</script>

<section
	id="room-activity"
	aria-label={m.activity_log_title()}
	class="flex h-full min-h-0 flex-col"
>
	<p class="border-b px-3 py-2 text-xs opacity-60">
		{m.activity_log_scope({ limit: String(ACTIVITY_HISTORY_LIMIT) })}
	</p>
	<div
		bind:this={log}
		role="log"
		aria-label={m.activity_log_entries()}
		aria-live="polite"
		aria-relevant="additions"
		data-testid="activity-log"
		class="min-h-0 flex-1 overflow-y-auto p-4 text-sm"
		onscroll={() => {
			if (log) sticky = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
		}}
	>
		<ol class="space-y-3">
			{#each entries as entry (entry.id)}
				<li
					data-event-id={entry.id}
					data-event-kind={entry.kind}
					data-event-member={entry.memberId}
					data-event-cell={entry.cellId}
					class="activity-entry break-words"
					title={entry.kind === 'opinion' ? entry.topic : undefined}
				>
					<time datetime={new Date(entry.at).toISOString()} class="mr-2 text-[10px] opacity-60"
						>{time(entry.at)}</time
					>
					{#if entry.color}<span
							class="mr-1 inline-block h-2 w-2 rounded-full"
							style:background-color="#{entry.color}"
							aria-hidden="true"
						></span>{/if}
					<span class="whitespace-pre-wrap">{activityLabel(entry)}</span>
				</li>
			{:else}<li class="text-xs opacity-60">{m.activity_log_empty()}</li>{/each}
		</ol>
	</div>
</section>

<style>
	.activity-entry {
		border-inline-start: 2px solid transparent;
		padding-inline-start: 8px;
	}
	.activity-entry[data-event-kind='join'] {
		border-color: var(--color-success);
	}
	.activity-entry[data-event-kind='leave'] {
		border-color: var(--color-error);
	}
	.activity-entry[data-event-kind='topic'] {
		border-color: var(--color-warning);
	}
</style>
