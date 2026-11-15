<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	let { role }: { role: string } = $props();
	const KEY = 'spectrum-v2-onboarding-v1';
	let visible = $state(false);
	onMount(() => {
		try {
			visible = localStorage.getItem(KEY) !== 'done';
		} catch {
			/* Storage may be disabled; stay quiet rather than nag. */
		}
	});
	function dismiss() {
		visible = false;
		try {
			localStorage.setItem(KEY, 'done');
		} catch {
			/* Storage may be disabled. */
		}
	}
</script>

{#if visible}
	<aside class="room-onboarding" data-testid="room-onboarding" aria-labelledby="onboarding-title">
		<h2 id="onboarding-title">{m.ux_onboarding_title()}</h2>
		<ul>
			{#if role !== 'spectator'}<li>
					<Icon name="plus" /><span>{m.ux_onboarding_notes()}</span>
				</li>{/if}
			<li><Icon name="link" /><span>{m.ux_onboarding_links()}</span></li>
			<li><Icon name="people" /><span>{m.ux_onboarding_audience()}</span></li>
		</ul>
		<button type="button" class="btn btn-xs" onclick={dismiss}>{m.ux_onboarding_dismiss()}</button>
	</aside>
{/if}

<style>
	/* Non-blocking: the card never swallows canvas clicks, only its button does. */
	.room-onboarding {
		position: fixed;
		left: 16px;
		bottom: 104px;
		z-index: 25;
		width: min(300px, calc(100% - 32px));
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--v2-radius-xl);
		background: var(--color-base-100);
		box-shadow: 0 12px 32px #0003;
		pointer-events: none;
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
		pointer-events: auto;
		margin-top: 0.625rem;
	}
	@media (max-width: 639px) {
		.room-onboarding {
			bottom: 132px;
			width: min(280px, calc(100% - 24px));
			left: 0.75rem;
		}
	}
</style>
