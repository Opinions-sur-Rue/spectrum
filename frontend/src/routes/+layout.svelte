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

<section>
	<article class="p-2 md:m-4 lg:m-8">
		<slot />
	</article>
	<ToastContainer />
</section>

<style>
</style>
