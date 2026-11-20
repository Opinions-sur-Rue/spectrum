<script lang="ts">
	import { onMount } from 'svelte';
	import { observeVoiceSpectrum, VOICE_SPECTRUM_BANDS } from './voice-spectrum';

	let { track, scale }: { track: MediaStreamTrack; scale: number } = $props();
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

	// Inner radius sits just outside the coloured pellet; the filled sine waves
	// oscillate outward from here so the white centre dot stays clear of them.
	const radius = $derived(14 * scale + 4);
	const maxOuter = $derived(radius + 12);
	const extent = $derived(maxOuter + 4);

	const SAMPLES = 200;

	/** Aggregate the log-spaced bands into three frequency groups plus a centroid. */
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

	/** A closed band between the base circle and a k-lobed sine, filled not stroked. */
	function wavePath(k: number, phase: number, energy: number, base: number): string {
		// A small idle floor keeps a faint ring visible as soon as the microphone
		// is open; the real energy then raises the lobes smoothly on top of it.
		const outer = base + 2 + 10 * energy;
		const points: string[] = [];
		for (let i = 0; i <= SAMPLES; i++) {
			const t = (i / SAMPLES) * Math.PI * 2;
			const r = base + (outer - base) * (0.5 + 0.5 * Math.sin(k * t + phase));
			points.push(`${(r * Math.cos(t)).toFixed(2)},${(r * Math.sin(t)).toFixed(2)}`);
		}
		for (let i = SAMPLES; i >= 0; i--) {
			const t = (i / SAMPLES) * Math.PI * 2;
			points.push(`${(base * Math.cos(t)).toFixed(2)},${(base * Math.sin(t)).toFixed(2)}`);
		}
		return `M ${points.join(' L ')} Z`;
	}

	const waves = $derived.by(() => [
		{ key: 'low', lobes: 3, phase: 0.4, path: wavePath(3, 0.4, groups.low, radius) },
		{ key: 'mid', lobes: 4, phase: 1.9, path: wavePath(4, 1.9, groups.mid, radius) },
		{ key: 'high', lobes: 5, phase: 3.3, path: wavePath(5, 3.3, groups.high, radius) }
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
				<stop offset={innerStop} style:stop-color="var(--color-primary)" stop-opacity="0" />
				<stop offset="1" style:stop-color="var(--color-primary)" stop-opacity="0.55" />
			</radialGradient>
			<radialGradient id="wsg-mid" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--color-accent)" stop-opacity="0" />
				<stop offset="1" style:stop-color="var(--color-accent)" stop-opacity="0.5" />
			</radialGradient>
			<radialGradient id="wsg-high" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={maxOuter}>
				<stop offset={innerStop} style:stop-color="var(--color-secondary)" stop-opacity="0" />
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
