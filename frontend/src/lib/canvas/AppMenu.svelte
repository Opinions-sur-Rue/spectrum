<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import { toolbarMenu } from './toolbar-menu';
	import { dialogFocus } from './dialog-focus';
	let {
		inRoom = false,
		presentation = $bindable(false)
	}: { inRoom?: boolean; presentation?: boolean } = $props();
	let theme = $state('lofi');
	let help = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let menu: HTMLDetailsElement;
	const themes = ['lofi', 'light', 'dark'];
	onMount(() => {
		try {
			const saved = localStorage.getItem('spectrum-theme');
			if (saved && themes.includes(saved)) theme = saved;
		} catch {
			/* Preferences are optional. */
		}
		document.documentElement.dataset.theme = theme;
	});
	function changeTheme(value: string) {
		theme = value;
		document.documentElement.dataset.theme = value;
		try {
			localStorage.setItem('spectrum-theme', value);
		} catch {
			/* Storage may be disabled. */
		}
	}
	$effect(() => {
		if (help && dialog && !dialog.open) dialog.showModal();
	});
</script>

<details bind:this={menu} class="relative z-40" use:toolbarMenu>
	<summary
		class="toolbar-summary"
		data-testid="app-menu"
		aria-label={m.v2_app_menu()}
		title={m.v2_app_menu()}
		><span class="text-sm font-semibold" aria-hidden="true">Aa</span><span
			class="hidden text-xs sm:inline">{m.ux_interface_options()}</span
		></summary
	>
	<div class="toolbar-popover bg-base-100 w-72 space-y-4 rounded-xl border p-4 shadow-xl">
		<label class="block text-xs"
			>{m.languages()}<select
				class="select select-sm mt-1 w-full"
				data-testid="language-select"
				value={getLocale()}
				onchange={(event) => setLocale(event.currentTarget.value as 'fr' | 'en')}
				><option value="fr">Français</option><option value="en">English</option></select
			></label
		>
		<p class="text-xs opacity-60">{m.v2_language_warning()}</p>
		<label class="block text-xs"
			>{m.theme()}<select
				class="select select-sm mt-1 w-full"
				data-testid="theme-select"
				value={theme}
				onchange={(event) => changeTheme(event.currentTarget.value)}
				><option value="lofi">{m.theme_default()}</option><option value="light"
					>{m.theme_light()}</option
				><option value="dark">{m.theme_dark()}</option></select
			></label
		>
		<button
			type="button"
			class="btn btn-sm btn-ghost w-full"
			onclick={() => {
				menu.open = false;
				help = true;
			}}>{m.v2_help()}</button
		>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- External v1 feedback form, localized through the catalog. -->
		<a
			href={m.link_feedback_form()}
			target="_blank"
			rel="noopener noreferrer"
			class="btn btn-sm btn-ghost w-full"
			data-testid="feedback-link">{m.header_feedback()} · {m.google_form()}</a
		>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{#if inRoom}<button
				type="button"
				class="btn btn-sm btn-ghost w-full"
				data-testid="presentation-toggle"
				aria-pressed={presentation}
				onclick={() => {
					menu.open = false;
					presentation = true;
				}}>{m.streamer_mode()}</button
			>{/if}
	</div>
</details>
{#if help}<dialog
		use:dialogFocus
		bind:this={dialog}
		class="bg-base-100 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40"
		aria-labelledby="v2-help-title"
		oncancel={() => {
			help = false;
		}}
	>
		<h2 id="v2-help-title" class="mb-4 text-lg font-semibold">{m.v2_help_title()}</h2>
		<div class="space-y-4 text-sm leading-relaxed">
			<p>{m.v2_help_positions()}</p>
			<p>{m.v2_help_roles()}</p>
			<p>{m.v2_help_notes()}</p>
			<p>{m.v2_help_ephemeral()}</p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- External feedback URL comes from the locale catalog. -->
			<a href={m.link_feedback_form()} target="_blank" rel="noopener noreferrer" class="link"
				>{m.header_feedback()} · {m.google_form()}</a
			>
		</div>
		<button
			type="button"
			class="btn mt-5"
			onclick={() => {
				help = false;
			}}>{m.close()}</button
		>
	</dialog>{/if}
