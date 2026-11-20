<script lang="ts">
	import { onMount } from 'svelte';
	import { observeVoiceSpectrum, VOICE_SPECTRUM_BANDS } from './voice-spectrum';
	import { spectrumSector } from './spectrum-curve';

	let { track, scale }: { track: MediaStreamTrack; scale: number } = $props();
	let bands = $state<number[]>([]);
	let reduced = $state(true);
	let seconds = $state(0);

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

	// Keep the spectrum outside the pellet, independent of canvas zoom.
	const radius = $derived(14 * scale + 4);
	const maxOuter = $derived(radius + 13.5);
	const extent = $derived(maxOuter + 4);

	/** Centroid is diagnostic only; geometry preserves every individual FFT band. */
	const groups = $derived.by(() => {
		if (bands.length !== VOICE_SPECTRUM_BANDS) return { low: 0, mid: 0, high: 0, centroid: 0 };
		const sum = (from: number, to: number) => {
			let total = 0;
			for (let i = from; i < to; i++) total += bands[i];
			return total / (to - from);
		};
		let total = 0;
		let weighted = 0;
		for (let i = 0; i < VOICE_SPECTRUM_BANDS; i++) {
			total += bands[i];
			weighted += bands[i] * i;
		}
		return {
			low: sum(0, 10),
			mid: sum(10, 21),
			high: sum(21, VOICE_SPECTRUM_BANDS),
			centroid: total > 0 ? weighted / total : 0
		};
	});

	const waves = $derived.by(() => [
		{ key: 'low', path: spectrumSector(bands, 0, 10, radius, seconds) },
		{ key: 'mid', path: spectrumSector(bands, 10, 21, radius, seconds) },
		{ key: 'high', path: spectrumSector(bands, 21, VOICE_SPECTRUM_BANDS, radius, seconds) }
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
		data-energy={Math.round((bands.reduce((sum, value) => sum + value, 0) / bands.length) * 100)}
		data-centroid={Math.round(groups.centroid)}
		viewBox="{-extent} {-extent} {extent * 2} {extent * 2}"
		style:width="{(extent * 2) / scale}px"
		style:height="{(extent * 2) / scale}px"
	>
		<defs>
			<radialGradient id="wsg-low" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--color-primary)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--color-primary)" stop-opacity="0.55" />
			</radialGradient>
			<radialGradient id="wsg-mid" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--color-accent)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--color-accent)" stop-opacity="0.5" />
			</radialGradient>
			<radialGradient id="wsg-high" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--color-secondary)" stop-opacity="0.18" />
				<stop offset="1" style:stop-color="var(--color-secondary)" stop-opacity="0.45" />
			</radialGradient>
		</defs>
		{#each waves as wave (wave.key)}
			<path class="wave" data-wave={wave.key} d={wave.path} fill={`url(#wsg-${wave.key})`} />
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
	.wave {
		stroke: none;
	}
</style>
