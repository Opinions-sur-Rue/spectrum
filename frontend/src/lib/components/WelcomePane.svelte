<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { LOGO_URL, LOGO_WIDTH } from '$lib/env';
	import Fa from 'svelte-fa';
	import { faXmark } from '@fortawesome/free-solid-svg-icons';
	import { onMount } from 'svelte';

	let { onStart, onJoin }: { onStart: () => void; onJoin: () => void } = $props();

	let dismissed = $state(false);

	const STORAGE_KEY = 'spectrum-onboarding-dismissed';

	onMount(() => {
		if (localStorage.getItem(STORAGE_KEY) === 'true') {
			dismissed = true;
		}
	});

	function dismiss() {
		dismissed = true;
		localStorage.setItem(STORAGE_KEY, 'true');
	}
</script>

{#if !dismissed}
	<section
		class="flex flex-col items-center gap-6 px-4 py-8 sm:flex-row sm:gap-10 sm:px-8"
		aria-label={m.welcome_title()}
	>
		<!-- Logo / Illustration -->
		<div class="flex flex-col items-center gap-4 sm:flex-1">
			<img
				src={LOGO_URL ?? './logo-light.png'}
				alt="Spectrum"
				width={LOGO_WIDTH}
				class="inline w-24 sm:w-32"
			/>
			<h2 class="text-center font-mono text-xl font-bold sm:text-2xl">
				{m.welcome_title()}
			</h2>
			<p class="max-w-md text-center text-sm leading-relaxed sm:text-base">
				{m.welcome_body()}
			</p>
		</div>

		<!-- Actions -->
		<div class="flex flex-col gap-4 sm:items-center">
			<button onclick={onStart} class="btn btn-success btn-lg rounded-lg shadow-lg">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path
						fill-rule="evenodd"
						d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
						clip-rule="evenodd"
					/>
				</svg>
				&nbsp;{m.start_spectrum()}
			</button>
			<button onclick={onJoin} class="btn btn-info btn-lg rounded-lg shadow-lg">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path
						fill-rule="evenodd"
						d="M16.5 6v11.5a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3Z"
						clip-rule="evenodd"
					/>
					<path
						fill-rule="evenodd"
						d="M8.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
						clip-rule="evenodd"
					/>
				</svg>
				&nbsp;{m.join_spectrum()}
			</button>
		</div>

		<!-- Dismiss -->
		<button
			onclick={dismiss}
			aria-label={m.welcome_dismiss()}
			class="btn btn-ghost btn-circle absolute top-4 right-4 sm:top-8 sm:right-8"
		>
			<Fa icon={faXmark} class="text-lg" />
		</button>
	</section>
{/if}

<style>
	section {
		position: relative;
		animation: welcome-fadein 0.4s ease forwards;
	}

	@keyframes welcome-fadein {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
