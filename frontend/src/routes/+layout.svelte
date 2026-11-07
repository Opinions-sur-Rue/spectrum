<script lang="ts">
	// @ts-nocheck
	import '../app.css';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import ToastContainer from '$lib/components/ToastContainer.svelte';

	// The v2 workspace is a full-screen canvas: it must not inherit the page
	// margins that the other routes use.
	const fullBleed = $derived(page.route.id === '/v2');
	let { children } = $props();
	// Static SPA hosting does not run a server hook to replace Paraglide placeholders.
	$effect(() => {
		document.documentElement.lang = getLocale();
	});
</script>

<svelte:head>
	<title>Spectrum by Opinions sur Rue</title>
	<meta name="description" content={m.subtitle()} />
</svelte:head>

<section class="flex h-dvh flex-col md:block md:h-auto">
	<article
		class={fullBleed
			? 'flex min-h-0 flex-1 flex-col overflow-hidden'
			: 'flex min-h-0 flex-1 flex-col overflow-y-auto p-0 md:m-4 md:block md:overflow-visible md:p-1 lg:m-8'}
	>
		{@render children()}
	</article>
	<ToastContainer />
</section>

<style>
</style>
