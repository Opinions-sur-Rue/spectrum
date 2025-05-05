<script lang="ts">
	export let title: string | undefined = undefined;
	export let subtitle: string | undefined = undefined;
	export let logo: string | undefined = undefined;
	export let logoWidth: number = 64;
	export let offsetSubtitle: number = -10;
</script>

<h1 class="font-mono text-4xl">
	{#if logo}<img
			src={logo}
			alt="Spectrum"
			width={logoWidth}
			style="display: inline;"
		/>&nbsp;{/if}{title}
</h1>

{#if subtitle}
	{#if logo && title}
		<p class="font-thin italic" style="margin-left: 92px; margin-top: {offsetSubtitle}px;">
			{subtitle}
		</p>
	{:else if logo}
		<p class="font-thin italic" style="margin-left: 10px; margin-top: {offsetSubtitle}px;">
			{subtitle}
		</p>
	{/if}
{/if}

<style>
</style>
