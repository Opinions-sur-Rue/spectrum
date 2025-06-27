<script lang="ts">
	// @ts-nocheck

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
</script>

<svelte:head>
	<title>Spectrum by Opinions sur Rue</title>
	<meta name="description" content={m.subtitle()} />
</svelte:head>

<section>
	<ul class="menu menu-horizontal bg-base-100 rounded-box float-right mt-6">
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
					<h2 class="card-title">Vous avez un peu de temps?</h2>
					<p>
						Aidez-nous à améliorer la plateforme en faisant vos retours sur le formulaire suivant : <a
							class="link link-info"
							target="_blank"
							rel="noopener"
							href="https://docs.google.com/forms/d/e/1FAIpQLSd53Jkrxa0l1Vcp4rTtrRlSJ8d7Vxx42EiMz0esjAvVSmvLNg/viewform?usp=header"
							>Google Form</a
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
						<div class="font-bold">C'est quoi un Spectrum ?</div>
						<div class="badge badge-info text-xs">Définition</div>
					</div>
					<p class="list-col-wrap text-xs">
						Spectrum est un outil visuel et interactif conçu pour faciliter les discussions
						constructives entre plusieurs personnes autour de croyances ou d'opinions. <br />
						Inspiré de la méthode de l'entretien épistémique (EE), il permet à chacun de positionner
						son niveau de confiance sur une échelle allant du doute au fort assentiment, tout en expliquant
						les raisons qui motivent cette position. <br />
						L'objectif n'est pas de débattre pour convaincre, mais d'encourager la réflexion critique,
						la clarification des idées et la compréhension mutuelle. En rendant visibles les divergences
						et les convergences, le Spectrum favorise un dialogue respectueux et introspectif, que ce
						soit en présentiel ou en ligne.
					</p>
				</li>

				<li class="list-row">
					<div>
						<div class="font-bold">Qu'est-ce qu'un Homme de fer ?</div>
						<div class="badge badge-info text-xs">Définition</div>
					</div>
					<p class="list-col-wrap text-xs">
						Un homme de fer est une technique de débat qui consiste à reformuler l'argument de son
						interlocuteur de la manière la plus forte, claire et juste possible, parfois même mieux
						que lui ne l'aurait exprimé lui-même. <br />
						Cela permet de montrer qu'on a bien compris sa position et d'engager un dialogue respectueux
						et constructif, loin des caricatures ou des attaques simplistes. C'est pourquoi il est couramment
						utilisé lors de Spectrum. <br />
						C'est l'opposé de l'homme de paille, qui déforme un argument pour mieux le réfuter. L'homme
						de fer vise au contraire la compréhension mutuelle.
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
