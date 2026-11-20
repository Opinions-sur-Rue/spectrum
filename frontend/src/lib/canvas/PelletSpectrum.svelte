<script lang="ts">
	import { onMount } from 'svelte';
	import { observeVoiceSpectrum, VOICE_SPECTRUM_BANDS } from './voice-spectrum';
	let { track, active, scale }: { track: MediaStreamTrack; active: boolean; scale: number } =
		$props();
	let bands = $state<number[]>([]);
	let reduced = $state(true);
	const inputTrack = $derived(reduced ? null : track);
	onMount(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = media.matches;
		const change = () => {
			reduced = media.matches;
		};
		media.addEventListener('change', change);
		return () => media.removeEventListener('change', change);
	});
	$effect(() => {
		const current = inputTrack;
		bands = [];
		if (!current) return;
		return observeVoiceSpectrum(current, (values) => {
			bands = values;
		});
	});
	const radius = $derived(14 * scale + 4);
	const extent = $derived(radius + 16);
</script>

{#if active && !reduced && bands.length === VOICE_SPECTRUM_BANDS}
	<svg
		class="pellet-spectrum"
		aria-hidden="true"
		focusable="false"
		data-testid="pellet-voice-spectrum"
		data-bands={bands.length}
		data-spectrum-energy={Math.round(
			(bands.reduce((sum, value) => sum + value, 0) / bands.length) * 100
		)}
		viewBox="{-extent} {-extent} {extent * 2} {extent * 2}"
		style:width="{(extent * 2) / scale}px"
		style:height="{(extent * 2) / scale}px"
	>
		{#each bands as value, index (index)}
			{@const angle = (index * 2 * Math.PI) / bands.length}
			{@const end = radius + 1.5 + value * 11}
			<line
				class="bar-outline"
				x1={Math.sin(angle) * radius}
				y1={-Math.cos(angle) * radius}
				x2={Math.sin(angle) * end}
				y2={-Math.cos(angle) * end}
			/>
			<line
				class="bar"
				x1={Math.sin(angle) * radius}
				y1={-Math.cos(angle) * radius}
				x2={Math.sin(angle) * end}
				y2={-Math.cos(angle) * end}
			/>
		{/each}
	</svg>
{/if}

<style>
	.pellet-spectrum {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		overflow: visible;
	}
	line {
		stroke-linecap: round;
	}
	.bar-outline {
		stroke: #052e16;
		stroke-width: 4.5;
	}
	.bar {
		stroke: #4ade80;
		stroke-width: 2.4;
	}
</style>
