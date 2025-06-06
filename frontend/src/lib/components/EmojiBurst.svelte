<script lang="ts">
	export let emoji = '🎉';
	export let trigger = false;
	export let handAnimation = false;
	export let handUsername: string;

	let show = false;
	let element: HTMLDivElement;
	let timeout: number | undefined;

	$: if (trigger) {
		if (timeout) clearTimeout(timeout);

		show = true;
		// eslint-disable-next-line svelte/infinite-reactive-loop
		timeout = setTimeout(() => {
			show = false;
			trigger = false;
		}, 1600);

		if (handAnimation) element?.setAttribute('data-username', handUsername);
	}

	const particleCount = 20;
	const particles = Array.from({ length: particleCount }, (_, i) => ({
		id: i,
		angle: Math.random() * 360,
		delay: Math.random() * 300
	}));
</script>

{#if show}
	<div class="emoji-burst-container">
		<div class="burst-inner">
			{#if !handAnimation}
				<div class="big-emoji">{emoji}</div>

				{#each particles as { id, angle, delay } (id)}
					<div
						class="particle"
						style="
				animation-delay: {delay}ms;
				--x: {Math.cos(angle) * 200}px;
				--y: {Math.sin(angle) * 200}px;"
					>
						{emoji}
					</div>
				{/each}
			{:else}
				<div bind:this={element} class="hand-raised">{emoji}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.emoji-burst-container {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 1000;
	}

	.burst-inner {
		position: relative;
		width: 0;
		height: 0;
	}

	.big-emoji {
		font-size: 12rem;
		animation: zoomOut 1.5s ease-out forwards;
		position: absolute;
		top: 0;
		left: 0;
		transform: translate(-50%, -50%);
		z-index: 100;
	}

	.hand-raised {
		font-size: 12rem;
		animation: raiseUp 1.5s cubic-bezier(0.25, 0.46, 0.45, 1.8) forwards;
		position: absolute;
		top: 0;
		left: 0;
		transform: translate(-50%, -50%);
		z-index: 100;
	}

	.hand-raised::after {
		content: attr(data-username);
		text-align: center;
		font-size: x-large;
		font-weight: bold;
		display: block;
		margin: auto;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
	}

	@keyframes zoomOut {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.2);
		}
		40% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.2);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.8);
		}
	}

	@keyframes raiseUp {
		0% {
			opacity: 0;
			transform: translate(-50%, 80%);
		}
		40% {
			opacity: 1;
			transform: translate(-50%, -50%);
		}
		80% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	.particle {
		position: absolute;
		font-size: 3rem; /* 🔍 twice bigger */
		top: 0;
		left: 0;
		transform: translate(-50%, -50%);
		animation: flyAway 1s ease-out forwards;
	}

	@keyframes flyAway {
		0% {
			transform: translate(-50%, -50%) translate(0, 0) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%) translate(var(--x), var(--y)) scale(0.8);
			opacity: 0;
		}
	}
</style>
