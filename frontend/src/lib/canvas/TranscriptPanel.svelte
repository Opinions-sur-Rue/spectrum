<script lang="ts">
	import { tick } from 'svelte';
	import type { TranscriptState } from './transcript-state';
	import { m } from '$lib/paraglide/messages.js';
	let {
		transcript,
		enabled,
		workerReady,
		browserMode = false,
		localSpeakers = 0,
		stageMembers = 0,
		language = 'fr',
		send,
		active = true
	}: {
		transcript: TranscriptState | null;
		enabled: boolean;
		workerReady: boolean;
		browserMode?: boolean;
		localSpeakers?: number;
		stageMembers?: number;
		language?: 'fr' | 'en' | 'auto';
		send: (op: string) => boolean;
		active?: boolean;
	} = $props();
	let log = $state<HTMLDivElement>();
	let sticky = $state(true);
	$effect(() => {
		if (!active) return;
		send('room.get');
		const timer = setInterval(() => send('room.get'), 3000);
		return () => clearInterval(timer);
	});
	$effect(() => {
		const sequence = transcript?.sequence;
		if (active && sticky && sequence !== undefined)
			void tick().then(() => {
				if (log) log.scrollTop = log.scrollHeight;
			});
	});
</script>

<section aria-label={m.ux_transcript_room()} class="flex h-full min-h-0 flex-col">
	<p class="border-b px-4 py-3 text-xs opacity-70">
		<strong
			>{language === 'fr' ? 'Français' : language === 'en' ? 'English' : 'Auto (FR/EN)'}</strong
		>
		—
		{enabled && browserMode
			? m.browser_stt_coverage({ count: String(localSpeakers), total: String(stageMembers) })
			: enabled
				? workerReady
					? m.ux_transcript_ready()
					: m.ux_transcript_starting()
				: m.ux_transcript_paused()}
		{m.ux_transcript_ephemeral()}
	</p>
	<p class="px-4 pt-3 text-xs opacity-60">
		{browserMode ? m.browser_stt_partial() : m.ux_transcript_hint()}
	</p>
	<div
		bind:this={log}
		role="log"
		aria-live="polite"
		aria-label={m.ux_transcript_segments()}
		class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm"
		onscroll={() => {
			if (log) sticky = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
		}}
	>
		{#each transcript?.segments.filter((segment) => !segment.discarded) ?? [] as segment (segment.id)}
			<div
				data-transcript-id={segment.id}
				data-transcript-final={segment.final}
				class:opacity-60={!segment.final}
			>
				<strong class="text-xs">{segment.speakerName}</strong>
				{#if segment.source === 'browser'}<span class="ml-2 text-xs opacity-60"
						>{m.browser_stt_source()}</span
					>{/if}
				<p class="break-words whitespace-pre-wrap">{segment.text}</p>
				{#if !segment.final}<span class="text-xs opacity-60">{m.ux_transcript_in_progress()}</span
					>{/if}
			</div>
		{:else}<p class="text-xs opacity-60">{m.ux_transcript_empty()}</p>{/each}
	</div>
</section>
