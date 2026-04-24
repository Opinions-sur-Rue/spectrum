<script lang="ts">
	// @ts-nocheck
	import '../app.css';
	import { m } from '$lib/paraglide/messages.js';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
</script>

<svelte:head>
	<title>Spectrum by Opinions sur Rue</title>
	<meta name="description" content={m.subtitle()} />
</svelte:head>

<section class="flex h-dvh flex-col md:block md:h-auto">
	<article
		class="flex min-h-0 flex-1 flex-col overflow-y-auto p-0 md:m-4 md:block md:overflow-visible md:p-1 lg:m-8"
	>
		<slot />
	</article>
	<ToastContainer />
</section>

<style>
</style>
