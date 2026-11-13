<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	let { track }: { track: MediaStreamTrack | null } = $props();
	let level = $state(0);
	let silent = $state(false);

	$effect(() => {
		const current = track;
		level = 0;
		silent = false;
		if (!current || current.readyState === 'ended') return;
		const AudioContextClass =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioContextClass) return;
		const context = new AudioContextClass();
		const source = context.createMediaStreamSource(new MediaStream([current]));
		const analyser = context.createAnalyser();
		analyser.fftSize = 512;
		source.connect(analyser);
		const samples = new Float32Array(analyser.fftSize);
		let frame = 0;
		let loudAt = performance.now();
		function tick() {
			analyser.getFloatTimeDomainData(samples);
			let power = 0;
			for (const sample of samples) power += sample * sample;
			level = Math.min(1, Math.sqrt(power / samples.length) * 4);
			const now = performance.now();
			if (level > 0.02) loudAt = now;
			silent = now - loudAt > 2500;
			frame = requestAnimationFrame(tick);
		}
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			source.disconnect();
			analyser.disconnect();
			void context.close();
		};
	});
</script>

<div class="mic-level" data-testid="mic-level">
	<span class="mic-label">{m.ux_mic_level()}</span>
	<div class="mic-meter" aria-hidden="true">
		<span style:width="{Math.round(level * 100)}%"></span>
	</div>
	{#if silent}<p class="mic-warning" role="status">{m.ux_mic_no_signal()}</p>{/if}
</div>

<style>
	.mic-level {
		display: grid;
		gap: 4px;
		font-size: 11px;
	}
	.mic-label {
		opacity: 0.7;
	}
	.mic-meter {
		height: 6px;
		border-radius: 999px;
		overflow: hidden;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}
	.mic-meter span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--color-success);
		transition: width 80ms linear;
	}
	.mic-warning {
		color: var(--color-warning);
		line-height: 1.35;
	}
	@media (prefers-reduced-motion: reduce) {
		.mic-meter span {
			transition: none;
		}
	}
</style>
