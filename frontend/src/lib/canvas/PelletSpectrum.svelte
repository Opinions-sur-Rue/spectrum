<script lang="ts">
	import { onMount } from 'svelte';
	import { observeVoiceSpectrum, VOICE_SPECTRUM_BANDS } from './voice-spectrum';
	import { simplifySpectrum, spectrumSector, SPECTRUM_VISUAL_BANDS } from './spectrum-curve';

	let { track, color = '' }: { track: MediaStreamTrack; color?: string } = $props();
	let bands = $state<number[]>([]);
	let reduced = $state(true);
	let seconds = $state(0);
	const id = $props.id();
	const amplitude = 0.85;
	const baseColor = $derived(/^[0-9a-f]{6}$/i.test(color) ? `#${color}` : 'var(--color-primary)');
	const visualBands = $derived(simplifySpectrum(bands));

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

	$effect(() => {
		if (reduced) return;
		let frame = 0;
		let last = 0;
		function animate(now: number) {
			if (document.hidden) return;
			if (now - last >= 40) {
				seconds = now / 1000;
				last = now;
			}
			frame = requestAnimationFrame(animate);
		}
		function visibility() {
			cancelAnimationFrame(frame);
			if (!document.hidden) frame = requestAnimationFrame(animate);
		}
		document.addEventListener('visibilitychange', visibility);
		visibility();
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener('visibilitychange', visibility);
		};
	});

	// Board-space geometry: the parent canvas scales pellet and spectrum together.
	const radius = 14 + 3;
	const maxOuter = radius + 13.5 * amplitude;
	const extent = maxOuter + 4;

	/** Centroid is diagnostic only; geometry preserves every individual FFT band. */
	const centroid = $derived.by(() => {
		if (bands.length !== VOICE_SPECTRUM_BANDS) return 0;
		let total = 0;
		let weighted = 0;
		for (let i = 0; i < VOICE_SPECTRUM_BANDS; i++) {
			total += bands[i];
			weighted += bands[i] * i;
		}
		return total > 0 ? weighted / total : 0;
	});

	const waves = $derived.by(() => [
		{ key: 'low', path: spectrumSector(visualBands, 0, 4, radius, seconds, amplitude) },
		{ key: 'mid', path: spectrumSector(visualBands, 4, 8, radius, seconds, amplitude) },
		{
			key: 'high',
			path: spectrumSector(visualBands, 8, SPECTRUM_VISUAL_BANDS, radius, seconds, amplitude)
		}
	]);

	const innerStop = $derived(Math.min(0.98, radius / maxOuter));
</script>

{#if !reduced && bands.length === VOICE_SPECTRUM_BANDS}
	<svg
		class="pellet-spectrum"
		aria-hidden="true"
		focusable="false"
		data-testid="pellet-voice-spectrum"
		data-bands={bands.length}
		data-resolution={visualBands.length}
		data-energy={Math.round((bands.reduce((sum, value) => sum + value, 0) / bands.length) * 100)}
		data-centroid={Math.round(centroid)}
		viewBox="{-extent} {-extent} {extent * 2} {extent * 2}"
		style:width="{extent * 2}px"
		style:height="{extent * 2}px"
		style:--spectrum-color={baseColor}
	>
		<defs>
			<radialGradient id="{id}-low" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--spectrum-color)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--spectrum-color)" stop-opacity="0.55" />
			</radialGradient>
			<radialGradient id="{id}-mid" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--spectrum-mid)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--spectrum-mid)" stop-opacity="0.5" />
			</radialGradient>
			<radialGradient id="{id}-high" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--spectrum-high)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--spectrum-high)" stop-opacity="0.45" />
			</radialGradient>
		</defs>
		{#each waves as wave (wave.key)}
			<path class="wave" data-wave={wave.key} d={wave.path} fill={`url(#${id}-${wave.key})`} />
		{/each}
	</svg>
{/if}

<style>
	.pellet-spectrum {
		--spectrum-mid: color-mix(in oklab, var(--spectrum-color) 75%, var(--color-base-content));
		--spectrum-high: color-mix(in oklab, var(--spectrum-color) 55%, var(--color-base-content));
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		overflow: visible;
	}
	.wave {
		stroke: none;
	}
</style>
