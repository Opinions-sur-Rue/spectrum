<script lang="ts">
	import type { RoomState, SpectrumState } from './room-client';
	import { cellLabel, type SpectrumCell } from './cells';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import { toolbarMenu } from './toolbar-menu';
	let {
		room,
		spectrum,
		detect,
		ready,
		focusPellet
	}: {
		room: RoomState;
		spectrum: SpectrumState | null;
		detect: ((x: number, y: number) => SpectrumCell | null) | null;
		ready: boolean;
		focusPellet: () => void;
	} = $props();
	let menu = $state<HTMLDetailsElement>();
	let announcement = $state('');
	const onStage = $derived(room.role !== 'spectator');
	const own = $derived(
		onStage ? spectrum?.pellets.find((pellet) => pellet.memberId === room.userId) : undefined
	);
	const available = $derived(onStage && ready && !!own && !!detect);
	const cell = $derived(available && own && detect ? (detect(own.x, own.y)?.id ?? null) : null);
	const label = $derived(
		!ready
			? m.ux_opinion_offline()
			: !available
				? m.ux_opinion_unavailable()
				: cell
					? cellLabel(cell)
					: m.ux_opinion_outside()
	);
	const announcementContext = $derived(
		`${room.roomId}:${room.userId}:${spectrum?.revision}:${spectrum?.topic}`
	);
	$effect(() => {
		// New room/proposition/configuration invalidates any queued old opinion.
		void announcementContext;
		const text = available ? m.ux_opinion_current({ opinion: label }) : '';
		announcement = '';
		if (!text) return;
		// Announce a settled cell, never every intermediate drag coordinate.
		const timer = setTimeout(() => {
			announcement = text;
		}, 400);
		return () => clearTimeout(timer);
	});
</script>

{#if onStage}
	<div class="current-opinion" data-testid="current-opinion">
		<span class="opinion-value">{m.ux_opinion_current({ opinion: label })}</span>
		<details bind:this={menu} class="relative" use:toolbarMenu>
			<summary class="toolbar-summary" aria-label={m.ux_opinion_help()} title={m.ux_opinion_help()}
				><Icon name="help" /></summary
			>
			<div class="toolbar-popover opinion-help bg-base-100 rounded-xl border p-3 shadow-xl">
				<p>{m.ux_opinion_hint()}</p>
				<button
					type="button"
					class="btn btn-sm mt-2"
					disabled={!available}
					onclick={() => {
						if (!available || !menu) return;
						menu.open = false;
						focusPellet();
					}}>{m.ux_opinion_focus()}</button
				>
			</div>
		</details>
		<span
			class="sr-only"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			data-testid="opinion-announcement">{announcement}</span
		>
	</div>
{/if}

<style>
	.current-opinion {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		max-width: 100%;
	}
	.opinion-value {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: var(--v2-text-base);
		font-weight: 600;
		line-height: 1.35;
	}
	.opinion-help {
		width: min(20rem, calc(100vw - 24px));
		font-size: var(--v2-text-base);
		line-height: 1.5;
	}
	@media (max-width: 639px) {
		.current-opinion {
			order: 1;
			flex-basis: 100%;
			justify-content: space-between;
		}
	}
</style>
