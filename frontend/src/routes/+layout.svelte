<script lang="ts">
	// @ts-nocheck

	import '../app.css';

	import { NotificationDisplay } from '$lib/notifications';

	let description = 'Welcome to Spectrum.';
</script>

<svelte:head>
	<title>Opinions sur Rue — Spectrum</title>
	<meta name="description" content={description} />
</svelte:head>

<section>
	<article class="p-2 md:m-4 lg:m-8">
		<slot />
	</article>

	<NotificationDisplay />
</section>

<style>
</style>
