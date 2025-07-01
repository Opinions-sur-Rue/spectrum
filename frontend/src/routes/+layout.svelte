<script lang="ts">
	// @ts-nocheck
	/* eslint svelte/no-at-html-tags: "off" */
	import '../app.css';

	import { NotificationDisplay } from '$lib/notifications';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import Fa from 'svelte-fa';
	import {
		faCircleInfo,
		faFileCircleQuestion,
		faGlobe,
		faSignal
	} from '@fortawesome/free-solid-svg-icons';
	import { setContext } from 'svelte';

	let streamerMode: boolean = $state(false);

	setContext('streamerMode', {
		activateStreamerMode() {
			streamerMode = true;
		},
		deactivateStreamerMode() {
			streamerMode = false;
		}
	});
</script>

<svelte:head>
	<title>Spectrum by Opinions sur Rue</title>
	<meta name="description" content={m.subtitle()} />
</svelte:head>

<section>
	<ul
		class="menu menu-horizontal bg-base-100 rounded-box float-right mt-6"
		class:hidden={streamerMode}
	>
		<li class="dropdown dropdown-end tooltip hidden" data-tip="Signal">
			<div
				tabindex="0"
				role="button"
				class="btn btn-ghost rounded-field indicator after:ml-2 after:transition-transform after:duration-200 after:content-['+']"
			>
				<Fa icon={faSignal} class="text-lg " />
			</div>
			<div tabindex="0" class="dropdown-content bg-base-100 rounded-box z-1 w-max shadow-sm">
				<div class="stats">
					<div class="stat">
						<div class="stat-title">Server Ping</div>
						<div class="stat-value">120ms</div>
					</div>

					<div class="stat">
						<div class="stat-title">Server Status</div>
						<div class="stat-value text-success">Healthy</div>
					</div>
				</div>
			</div>
		</li>
		<li class="dropdown dropdown-end tooltip" data-tip="Feedback">
			<div tabindex="0" role="button" class="btn btn-ghost rounded-field">
				<Fa icon={faFileCircleQuestion} class="text-lg" />
			</div>
			<div
				tabindex="0"
				class="card card-sm dropdown-content bg-base-100 rounded-box z-1 w-max shadow-sm"
			>
				<div tabindex="0" class="card-body">
					<h2 class="card-title">{m.info_do_you_have_a_moment()}</h2>
					<p>
						{m.info_help_us_form()}<a
							class="link link-info"
							target="_blank"
							rel="noopener"
							href={m.link_feedback_form()}>Google Form</a
						>
					</p>
				</div>
			</div>
		</li>
		<li class="dropdown dropdown-end tooltip hidden md:block" data-tip="Informations">
			<div tabindex="0" role="button" class="btn btn-ghost rounded-field">
				<Fa icon={faCircleInfo} class="text-lg" />
			</div>
			<ul class="list dropdown-content bg-base-100 rounded-box z-1 w-3xl max-w-screen shadow-sm">
				<li class="list-row">
					<div>
						<div class="font-bold">{m.info_what_is_spectrum()}</div>
						<div class="badge badge-info text-xs">{m.info_definition()}</div>
					</div>
					<p class="list-col-wrap text-xs">
						{@html m.info_what_is_spectrum_answer()}
					</p>
				</li>

				<li class="list-row">
					<div>
						<div class="font-bold">{m.info_what_is_steelman()}</div>
						<div class="badge badge-info text-xs">{m.info_definition()}</div>
					</div>
					<p class="list-col-wrap text-xs">
						{@html m.info_what_is_steelman_answer()}
					</p>
				</li>
			</ul>
		</li>
		<li class="dropdown dropdown-end tooltip" data-tip="Langues">
			<div tabindex="0" role="button" class="btn btn-ghost rounded-field">
				<Fa icon={faGlobe} class="text-lg" />
				<svg
					width="12px"
					height="12px"
					class="inline-block h-2 w-2 fill-current opacity-60"
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 2048 2048"
				>
					<path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z"></path>
				</svg>
			</div>
			<ul class="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm">
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
		</li>
	</ul>

	<article class="p-2 md:m-4 lg:m-8">
		<slot />
	</article>

	<NotificationDisplay />
</section>

<style>
</style>
