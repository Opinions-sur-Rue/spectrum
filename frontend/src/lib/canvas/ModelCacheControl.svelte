<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import ConfirmAction, { type Confirmation } from './ConfirmAction.svelte';
	import { clearModelCache } from './model-cache';

	let { idle, busy = $bindable(false) }: { idle: boolean; busy?: boolean } = $props();
	let available = $state(false);
	let action = $state<Confirmation | null>(null);
	let result = $state<'cleared' | 'failed' | ''>('');
	onMount(() => {
		available = typeof caches !== 'undefined';
	});
	$effect(() => {
		if (!idle) result = '';
	});
	function confirm() {
		if (!action || !idle || busy || !available) return false;
		busy = true;
		result = '';
		void clearModelCache()
			.then(() => {
				result = 'cleared';
			})
			.catch(() => {
				result = 'failed';
			})
			.finally(() => {
				busy = false;
			});
		return true;
	}
</script>

<div class="w-full border-t pt-2" data-testid="model-cache-controls" aria-busy={busy}>
	<p class="mb-2 text-xs opacity-75">{m.model_cache_description()}</p>
	<button
		type="button"
		class="btn btn-sm btn-ghost"
		data-testid="model-cache-clear"
		disabled={!available || !idle || busy}
		onclick={() => {
			result = '';
			action = {
				op: 'local.models.clear',
				payload: null,
				title: m.model_cache_clear_title(),
				body: m.model_cache_clear_body()
			};
		}}>{busy ? m.model_cache_clearing() : m.model_cache_clear()}</button
	>
	{#if !idle}<p class="mt-1 text-xs opacity-75">{m.model_cache_stop_first()}</p>{/if}
	{#if !available}<p class="mt-1 text-xs opacity-75">{m.model_cache_unavailable()}</p>{/if}
	{#if result === 'failed'}<p role="alert" class="text-error mt-1 text-xs">
			{m.model_cache_failed()}
		</p>
	{/if}
	<p aria-live="polite" aria-atomic="true" class="mt-1 text-xs" data-testid="model-cache-status">
		{result === 'cleared' ? m.model_cache_cleared() : ''}
	</p>
</div>

<ConfirmAction bind:action ready={idle && !busy && available} send={confirm} />
