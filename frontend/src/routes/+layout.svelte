<script lang="ts">
	// @ts-nocheck

	import '../app.css';

	import { NotificationDisplay } from '$lib/notifications';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>Spectrum by Opinions sur Rue</title>
	<meta name="description" content={m.subtitle()} />
</svelte:head>

<section>
	<div class="dropdown dropdown-end float-right mt-4 mr-4 md:mt-0 md:mr-8">
		<div
			tabindex="0"
			role="button"
			class="btn btn-sm btn-ghost gap-1 px-1.5 text-[.5625rem] font-bold"
			aria-label="Language"
			title="Change Language"
		>
			<svg
				class="text-base-content/70 size-4"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				><path
					stroke-linejoin="round"
					stroke-linecap="round"
					stroke-width="2"
					fill="none"
					stroke="currentColor"
					d="M12 21a9 9 0 1 0 0-18m0 18a9 9 0 1 1 0-18m0 18c2.761 0 3.941-5.163 3.941-9S14.761 3 12 3m0 18c-2.761 0-3.941-5.163-3.941-9S9.239 3 12 3M3.5 9h17m-17 6h17"
				></path></svg
			>
			<svg
				class="mt-px hidden size-2 fill-current opacity-60 sm:inline-block"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 2048 2048"
				><path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z"></path></svg
			>
		</div>
		<div
			tabindex="0"
			class="dropdown-content bg-base-200 text-base-content rounded-box top-px mt-8 h-[15rem] max-h-[calc(100vh-8.6rem)] w-56 overflow-y-auto border border-white/5 shadow-2xl outline-1 outline-black/5"
		>
			<ul class="menu menu-sm w-full">
				<li>
					<button class:menu-active={getLocale() === 'en'} onclick={() => setLocale('en')}
						><span class="pe-4 font-mono text-[.5625rem] font-bold tracking-[0.09375rem] opacity-40"
							>EN</span
						> <span class="font-[sans-serif]">English</span></button
					>
				</li>
				<li>
					<button class:menu-active={getLocale() === 'fr'} onclick={() => setLocale('fr')}
						><span class="pe-4 font-mono text-[.5625rem] font-bold tracking-[0.09375rem] opacity-40"
							>FR</span
						> <span class="font-[sans-serif]">Français</span></button
					>
				</li>
			</ul>
		</div>
	</div>

	<article class="p-2 md:m-4 lg:m-8">
		<slot />
	</article>

	<NotificationDisplay />
</section>

<style>
</style>
