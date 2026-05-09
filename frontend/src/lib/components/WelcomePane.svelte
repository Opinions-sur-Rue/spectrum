<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import { LOGO_URL, LOGO_WIDTH } from '$lib/env';
	import Fa from 'svelte-fa';
	import { faGlobe, faPlayCircle, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';

	let {
		onStart,
		onJoin,
		ready,
		reconnecting
	}: {
		onStart: () => void;
		onJoin: () => void;
		ready: boolean;
		reconnecting: boolean;
	} = $props();

	const modalId = 'welcome-modal';

	$effect(() => {
		const el = document.getElementById(modalId);
		if (el instanceof HTMLDialogElement && !el.open) {
			el.showModal();
		}
	});

	function pickLocale(locale: 'en' | 'fr', event: Event) {
		setLocale(locale);
		(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
	}
</script>

<dialog
	id={modalId}
	class="modal"
	aria-label={m.welcome_title()}
	oncancel={(e) => e.preventDefault()}
>
	<div class="modal-box relative flex flex-col items-center gap-6 p-4 sm:p-6 md:p-8">
		<!-- Language switcher (always reachable since the modal is non-dismissable) -->
		<details class="dropdown dropdown-end absolute top-2 right-2">
			<summary class="btn btn-ghost btn-sm" aria-label="Languages">
				<Fa icon={faGlobe} class="text-base" />
			</summary>
			<ul class="dropdown-content menu bg-base-100 rounded-box z-1 mt-1 w-40 p-2 shadow-sm">
				<li>
					<button class:menu-active={getLocale() === 'en'} onclick={(e) => pickLocale('en', e)}>
						<span class="pe-2 font-mono text-[.5625rem] font-bold tracking-[0.09375rem] opacity-40"
							>EN</span
						>
						<span class="font-[sans-serif]">English</span>
					</button>
				</li>
				<li>
					<button class:menu-active={getLocale() === 'fr'} onclick={(e) => pickLocale('fr', e)}>
						<span class="pe-2 font-mono text-[.5625rem] font-bold tracking-[0.09375rem] opacity-40"
							>FR</span
						>
						<span class="font-[sans-serif]">Français</span>
					</button>
				</li>
			</ul>
		</details>

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

		<div
			class="flex min-h-16 w-full flex-col items-stretch justify-center gap-4 sm:flex-row sm:flex-wrap sm:items-center"
		>
			{#if !ready}
				<span class="text-center font-mono text-sm">
					<span class="loading loading-spinner loading-md text-success"></span>
					&nbsp;Loading...
				</span>
			{:else if reconnecting}
				<span class="text-center font-mono text-sm">
					<span class="loading loading-spinner loading-sm text-warning"></span>
					<span class="text-warning">&nbsp;Reconnecting...</span>
				</span>
			{:else}
				<button onclick={onStart} class="btn btn-success btn-lg rounded-lg shadow-lg">
					<Fa icon={faPlayCircle} />&nbsp;{m.start_spectrum()}
				</button>
				<button onclick={onJoin} class="btn btn-info btn-lg rounded-lg shadow-lg">
					<Fa icon={faRightFromBracket} />&nbsp;{m.join_spectrum()}
				</button>
			{/if}
		</div>
	</div>
</dialog>
