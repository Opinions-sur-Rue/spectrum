<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Tween } from 'svelte/motion';
	import { linear } from 'svelte/easing';

	export let background: string;
	export let close: VoidFunction;
	export let message: string;
	export let duration: number;

	let progressValue = new Tween(0, {
		duration, // Duration in milliseconds
		easing: linear // Easing function for the animation
	});

	progressValue.set(100).then(() => close());
</script>

<div role="alert" class={'alert alert- z-1000' + background} transition:fade>
	<button class="close" on:click={() => close()}> ✕ </button>
	<div class="content">
		{message}
		<progress class="progress w-full" value={progressValue.current} max="100"></progress>
	</div>
</div>
