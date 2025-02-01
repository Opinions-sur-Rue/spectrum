<script lang="ts">
	export let title;
	export let subtitle;
	export let logo = undefined;
	export let clientWidth = 0;
</script>

<h1 class="w3-xxlarge">
	{#if logo}<img src={logo} alt="Logo" width="64px" />{/if}{title}
</h1>

<p bind:clientWidth>{subtitle}</p>

<style>
	h1 {
		font-family: monospace;
	}

	p {
		font-family: system-ui;
		font-weight: lighter;
	}
</style>
