<script lang="ts">
	// @ts-nocheck

	import '../app.css';

	import { NotificationDisplay } from '$lib/notifications';

	let themes = {
		// These are the defaults
		danger: '#b0615b',
		success: '#5bb065',
		warning: '#b08a5b',
		info: '#5b87b0',
		default: '#dddddd' // relates to simply '.show()'
	};

	let description = 'Welcome to Spectrum.';
</script>

<svelte:head>
	<title>Opinions sur Rue — Spectrum</title>
	<meta name="description" content={description} />
</svelte:head>

<section class="w3-main w3-row-padding w3-margin-top w3-margin-bottom">
	<article class="w3-margin w3-padding">
		<slot />
	</article>

	<NotificationDisplay {themes} />
</section>

<style>
	section.w3-main {
		width: 100%;
	}
</style>
