<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	let { role }: { role: string } = $props();
	let help: HTMLDetailsElement;
</script>

<details bind:this={help} class="room-onboarding" data-testid="room-onboarding">
	<summary aria-label={m.ux_onboarding_open()} title={m.ux_onboarding_open()}
		><Icon name="help" /><span>{m.ux_onboarding_open()}</span></summary
	>
	<div class="guidance-content">
		<h2 id="onboarding-title">{m.ux_onboarding_title()}</h2>
		<ul>
			{#if role !== 'spectator'}<li>
					<Icon name="plus" /><span>{m.ux_onboarding_notes()}</span>
				</li>{/if}
			<li><Icon name="link" /><span>{m.ux_onboarding_links()}</span></li>
			<li><Icon name="people" /><span>{m.ux_onboarding_audience()}</span></li>
		</ul>
		<button
			type="button"
			class="btn btn-sm"
			onclick={() => {
				help.open = false;
				help.querySelector('summary')?.focus();
			}}>{m.ux_onboarding_close()}</button
		>
	</div>
</details>

<style>
	.room-onboarding {
		margin-left: auto;
		max-width: 100%;
		min-width: 0;
	}
	.room-onboarding[open] {
		flex-basis: 100%;
		margin-left: 0;
	}
	summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		cursor: pointer;
		list-style: none;
		font-size: var(--v2-text-sm);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.guidance-content {
		padding: 0.5rem 0;
		max-height: min(30dvh, 12rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	h2 {
		font-size: var(--v2-text-md);
		font-weight: 650;
		margin-bottom: 0.5rem;
	}
	ul {
		display: grid;
		gap: 0.375rem;
		font-size: var(--v2-text-sm);
		line-height: 1.4;
	}
	li {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	button {
		margin-top: 0.625rem;
	}
	@media (max-width: 639px) {
		.room-onboarding:not([open]) {
			flex: 0 0 auto;
		}
		summary {
			min-width: 44px;
			justify-content: center;
		}
		.room-onboarding:not([open]) summary span {
			display: none;
		}
	}
</style>
