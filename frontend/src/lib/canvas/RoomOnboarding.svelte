<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { dialogFocus } from './dialog-focus';
	import { relationLabel, relationSymbol, RELATIONS } from './labels';
	import { trapPanelFocus } from './panel-modality';
	let {
		role,
		nickname = '',
		ready = true,
		savePseudonym
	}: {
		role: string;
		nickname?: string;
		ready?: boolean;
		savePseudonym?: (nickname: string) => boolean;
	} = $props();
	let open = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let name = $state('');
	let saved = $state(false);
	let failed = $state(false);
	$effect(() => {
		if (open && dialog && !dialog.open) dialog.showModal();
	});
	function show() {
		name = nickname;
		saved = false;
		failed = false;
		open = true;
	}
	function close() {
		open = false;
	}
	function submit(event: SubmitEvent) {
		event.preventDefault();
		const value = name.trim();
		if (!ready || !value || !savePseudonym) return;
		if (savePseudonym(value)) {
			saved = true;
			failed = false;
			name = '';
		} else {
			saved = false;
			failed = true;
		}
	}
</script>

<button
	type="button"
	class="onboarding-trigger v2-control"
	data-testid="room-onboarding"
	aria-haspopup="dialog"
	aria-label={m.ux_onboarding_open()}
	title={m.ux_onboarding_open()}
	onclick={show}
>
	<Icon name="help" /><span>{m.ux_onboarding_open()}</span>
</button>

{#if open}
	<dialog
		use:dialogFocus
		bind:this={dialog}
		class="onboarding-dialog"
		data-testid="room-onboarding-dialog"
		aria-labelledby="onboarding-title"
		oncancel={() => {
			open = false;
		}}
		onclose={() => {
			open = false;
		}}
		onkeydown={(event) => {
			if (event.key === 'Tab' && dialog) {
				event.stopPropagation();
				trapPanelFocus(dialog, event);
			}
		}}
	>
		<header class="onboarding-heading">
			<h2 id="onboarding-title">{m.ux_onboarding_title()}</h2>
			<IconButton icon="cancel" label={m.close()} onclick={close} />
		</header>
		<form class="profile-step" onsubmit={submit}>
			<label for="onboarding-pseudonym">{m.ux_onboarding_profile_title()}</label>
			<p id="onboarding-pseudonym-hint">{m.ux_onboarding_profile_hint()}</p>
			<div class="profile-fields">
				<input
					id="onboarding-pseudonym"
					class="input input-sm min-w-0 flex-1"
					aria-describedby="onboarding-pseudonym-hint"
					placeholder={nickname || m.v2_pseudonym_placeholder()}
					maxlength="40"
					bind:value={name}
					disabled={!ready}
					autocomplete="nickname"
				/>
				<button type="submit" class="btn btn-sm" disabled={!ready || !name.trim()}
					>{m.ux_profile_save()}</button
				>
			</div>
			<p class="status" role="status">
				{#if saved}{m.ux_onboarding_saved()}{:else if failed}{m.ux_onboarding_save_failed()}{/if}
			</p>
		</form>
		<ul class="tips">
			{#if role !== 'spectator'}<li>
					<Icon name="plus" /><span>{m.ux_onboarding_notes()}</span>
				</li>{/if}
			<li><Icon name="link" /><span>{m.ux_onboarding_links()}</span></li>
			<li><Icon name="people" /><span>{m.ux_onboarding_audience()}</span></li>
		</ul>
		<section class="relation-legend" aria-labelledby="onboarding-relations">
			<h3 id="onboarding-relations">{m.ux_onboarding_relations_title()}</h3>
			<p>{m.ux_onboarding_relations_hint()}</p>
			<ul>
				{#each RELATIONS as relation (relation)}
					<li>
						<span class="legend-symbol" aria-hidden="true">{relationSymbol(relation)}</span>
						<span>{relationLabel(relation)}</span>
					</li>
				{/each}
			</ul>
		</section>
		<button type="button" class="btn btn-sm onboarding-close" onclick={close}
			>{m.ux_onboarding_close()}</button
		>
	</dialog>
{/if}

<style>
	.onboarding-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
		min-height: 44px;
		max-width: 100%;
		min-width: 0;
		padding: 0 0.5rem;
		border-radius: var(--v2-radius-md);
		font-size: var(--v2-text-sm);
		cursor: pointer;
	}
	.onboarding-trigger:hover {
		background: var(--color-base-200);
	}
	.onboarding-trigger:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.onboarding-dialog {
		width: min(32rem, calc(100% - 2rem));
		max-height: calc(100dvh - 2rem);
		margin: auto;
		padding: 1rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--v2-radius-xl);
		background: var(--color-base-100);
		color: var(--color-base-content);
		overflow-y: auto;
		overscroll-behavior: contain;
		box-shadow: 0 18px 48px #0003;
	}
	.onboarding-dialog::backdrop {
		background: #0006;
	}
	.onboarding-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	h2 {
		font-size: var(--v2-text-lg);
		font-weight: 700;
	}
	h3 {
		font-size: var(--v2-text-sm);
		font-weight: 650;
	}
	.profile-step {
		display: grid;
		gap: 0.375rem;
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--v2-radius-lg);
		background: var(--color-base-200);
	}
	.profile-step label {
		font-size: var(--v2-text-sm);
		font-weight: 600;
	}
	.profile-step p {
		font-size: var(--v2-text-xs);
		opacity: 0.7;
	}
	.profile-fields {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.status:empty {
		display: none;
	}
	.tips {
		display: grid;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: var(--v2-text-sm);
		line-height: 1.4;
	}
	.tips li {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.relation-legend {
		margin-top: 0.875rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-base-300);
	}
	.relation-legend p {
		margin-top: 0.25rem;
		font-size: var(--v2-text-xs);
		opacity: 0.7;
	}
	.relation-legend ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.875rem;
		margin-top: 0.5rem;
		font-size: var(--v2-text-xs);
	}
	.relation-legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.legend-symbol {
		font-weight: 700;
	}
	.onboarding-close {
		margin-top: 1rem;
	}
	@media (max-width: 639px) {
		.onboarding-trigger span {
			display: none;
		}
		.onboarding-trigger {
			margin-left: 0;
			justify-content: center;
			padding: 0;
			min-width: 44px;
		}
	}
</style>
