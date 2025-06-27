<script lang="ts">
	export let title: string | undefined = undefined;
	export let subtitle: string | undefined = undefined;
	export let logo: string | undefined = undefined;
	export let logoWidth: number = 64;
</script>

<div class="header flex">
	<h1 class="flex-none font-mono text-4xl">
		{#if logo}<img src={logo} alt="Spectrum" width={logoWidth} style="display: inline;" />{/if}<span
			class="ml-1">{title}</span
		>
	</h1>

	<div class="flex-1 p-4">
		{#if subtitle}
			{#if logo && title}
				<p class="mt-2 text-center font-thin italic">
					{subtitle}
				</p>
			{:else if logo}
				<p class="mt-2 ml-6 text-sm font-thin italic">
					{subtitle}
				</p>
			{/if}
		{/if}
		<slot />
	</div>
</div>

<style>
</style>
