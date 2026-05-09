<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { LOGO_URL, LOGO_WIDTH } from '$lib/env';
	import Fa from 'svelte-fa';
	import {
		faXmark,
		faPlayCircle,
		faRightFromBracket
	} from '@fortawesome/free-solid-svg-icons';
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
	<div
		class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
		aria-label={m.welcome_title()}
		role="dialog"
		aria-modal="true"
	>
		<section
			class="bg-base-100 relative flex w-full max-w-xl flex-col items-center gap-6 rounded-xl p-6 shadow-2xl sm:p-8"
		>
			<!-- Logo / Illustration -->
			<div class="flex flex-col items-center gap-4">
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
			<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
				<button onclick={onStart} class="btn btn-success btn-lg rounded-lg shadow-lg">
					<Fa icon={faPlayCircle} />&nbsp;{m.start_spectrum()}
				</button>
				<button onclick={onJoin} class="btn btn-info btn-lg rounded-lg shadow-lg">
					<Fa icon={faRightFromBracket} />&nbsp;{m.join_spectrum()}
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
	</div>
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
