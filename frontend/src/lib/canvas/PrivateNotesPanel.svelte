<script lang="ts">
	import { onMount, tick } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import PersonalNotes from './PersonalNotes.svelte';
	import { panelModality, trapPanelFocus } from './panel-modality';
	let {
		roomId,
		open = $bindable(false),
		onClose
	}: {
		roomId: string;
		open?: boolean;
		onClose: () => void;
	} = $props();
	let panel = $state<HTMLElement>();
	let compact = $state(false);
	onMount(() => {
		const media = window.matchMedia('(max-width: 1023px)');
		const update = () => (compact = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});
	$effect(() => {
		if (open)
			void tick().then(() => {
				if (!open || panel?.contains(document.activeElement)) return;
				// Avoid surfacing the mobile keyboard until the person taps the field.
				const target = compact
					? panel.querySelector<HTMLElement>('button')
					: panel.querySelector<HTMLElement>('textarea');
				target?.focus();
			});
	});
	function close() {
		open = false;
		onClose();
	}
	function keepMobileFocus(event: KeyboardEvent) {
		if (compact && open && panel) trapPanelFocus(panel, event);
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (
			open &&
			event.key === 'Escape' &&
			!event.defaultPrevented &&
			!document.querySelector('dialog[open], details[name="room-toolbar"][open]')
		) {
			event.preventDefault();
			close();
		}
	}}
	onpointerdown={(event) => {
		if (
			open &&
			window.matchMedia('(max-width: 1023px)').matches &&
			event.target instanceof Element &&
			!panel?.contains(event.target) &&
			!event.target.closest('[data-testid="personal-notes-toggle"]')
		)
			open = false;
	}}
/>

<aside
	use:panelModality={compact && open}
	bind:this={panel}
	id="room-private-notes"
	class="personal-notes-panel"
	hidden={!open}
	aria-label={m.ux_tab_personal_notes()}
	role={compact ? 'dialog' : undefined}
	aria-modal={compact && open ? true : undefined}
	onkeydown={keepMobileFocus}
	data-testid="personal-notes-panel"
>
	<header class="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
		<div>
			<h2 class="text-sm font-semibold">{m.ux_tab_personal_notes()}</h2>
			<p class="mt-1 text-xs opacity-60">{m.personal_notes_private()}</p>
		</div>
		<IconButton
			icon="cancel"
			label={m.ux_close_private_notes()}
			data-testid="personal-notes-close"
			onclick={close}
		/>
	</header>
	<div class="personal-notes-body">
		<PersonalNotes {roomId} />
	</div>
</aside>

<style>
	.personal-notes-panel {
		min-width: 0;
		box-sizing: border-box;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: clamp(21rem, 30vw, 26rem);
		flex-shrink: 0;
		background: var(--color-base-100);
		border-left: 1px solid var(--color-base-300);
	}
	.personal-notes-panel[hidden] {
		display: none;
	}
	.personal-notes-body {
		min-width: 0;
		overflow: hidden;
		flex: 1;
		min-height: 0;
	}
	@media (max-width: 1023px) {
		.personal-notes-panel {
			position: fixed;
			z-index: 60;
			left: var(--v2-visible-x, 0px);
			top: var(--v2-visible-y, 0px);
			width: var(--v2-visible-width, 100%);
			height: var(--v2-visible-height, 100dvh);
			padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
				env(safe-area-inset-left);
			border: 1px solid var(--color-base-300);
			border-radius: 0;
			box-shadow: 0 -12px 36px #0002;
		}
		.personal-notes-panel :global(button.icon-button) {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
