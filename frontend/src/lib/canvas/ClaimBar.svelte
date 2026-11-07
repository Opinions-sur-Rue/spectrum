<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import type { RoomState, SpectrumState } from './room-client';
	let {
		room,
		spectrum,
		ready,
		send,
		presentation = false
	}: {
		room: RoomState;
		spectrum: SpectrumState | null;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
		presentation?: boolean;
	} = $props();
	let topic = $state('');
	let dirty = $state(false);
	let editing = $state(false);
	let form = $state<HTMLFormElement>();
	let input = $state<HTMLTextAreaElement>();
	let editButton = $state<HTMLButtonElement>();
	$effect(() => {
		if (editing) void tick().then(() => input?.focus());
	});
	$effect(() => {
		if (room.role !== 'admin') {
			topic = spectrum?.topic ?? '';
			dirty = false;
			editing = false;
		}
	});
	$effect(() => {
		if (spectrum && (!dirty || spectrum.topic === topic)) {
			topic = spectrum.topic;
			dirty = false;
		}
	});
	function cancel() {
		topic = spectrum?.topic ?? '';
		dirty = false;
		finishEditing();
	}
	function finishEditing() {
		editing = false;
		void tick().then(() => {
			if (room.role === 'admin' && !presentation) editButton?.focus();
		});
	}
</script>

<section class="claim-bar" data-testid="room-claim" aria-label={m.ux_current_claim()}>
	<div class="claim-heading">
		<span class="claim-eyebrow">{m.ux_current_claim()}</span><span class="claim-hint"
			>{room.role === 'admin'
				? editing
					? m.ux_claim_admin_hint()
					: m.ux_claim_view_hint()
				: room.role === 'participant'
					? m.ux_role_participant_hint()
					: m.ux_role_spectator_hint()}</span
		>
	</div>
	{#if room.role === 'admin' && !presentation && editing}
		<form
			bind:this={form}
			onsubmit={(event) => {
				event.preventDefault();
				if (ready && send('spectrum.topic', { topic })) finishEditing();
			}}
		>
			<textarea
				bind:this={input}
				aria-label={m.ux_current_claim()}
				data-testid="claim-input"
				placeholder={m.ux_claim_placeholder()}
				rows={topic.length > 100 ? 2 : 1}
				maxlength="500"
				disabled={!ready}
				bind:value={topic}
				oninput={() => {
					dirty = true;
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape' && !event.isComposing) {
						event.preventDefault();
						cancel();
					}
					if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						form?.requestSubmit();
					}
				}}
			></textarea>
			<div class="claim-actions">
				{#if dirty}<button
						type="submit"
						class="btn btn-sm btn-primary"
						data-testid="save-claim"
						disabled={!ready}><Icon name="save" />{m.ux_save_claim()}</button
					>{/if}<button type="button" class="btn btn-sm btn-ghost" onclick={cancel}
					>{m.cancel()}</button
				>
			</div>
		</form>
	{:else}<div class="claim-display">
			<h1>{spectrum?.topic || m.ux_no_claim()}</h1>
			{#if room.role === 'admin' && !presentation}<button
					bind:this={editButton}
					type="button"
					class="btn btn-sm btn-ghost"
					data-testid="edit-claim"
					disabled={!ready}
					onclick={() => (editing = true)}>{m.ux_edit_claim()}</button
				>{/if}
		</div>{/if}
</section>

<style>
	.claim-bar {
		flex-shrink: 0;
		padding: 14px 22px 16px;
		background: var(--color-base-100);
		border-bottom: 1px solid var(--color-base-300);
	}
	.claim-heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 7px;
	}
	.claim-eyebrow {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-weight: 700;
		opacity: 0.75;
	}
	.claim-hint {
		font-size: 11px;
		opacity: 0.75;
	}
	form {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.claim-actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}
	.claim-display {
		display: flex;
		align-items: start;
		gap: 12px;
	}
	.claim-display h1 {
		flex: 1;
	}
	textarea,
	h1 {
		min-width: 0;
		width: 100%;
		margin: 0;
		font-size: clamp(16px, 1.6vw, 22px);
		font-weight: 600;
		line-height: 1.45;
		background: transparent;
		overflow-wrap: anywhere;
	}
	textarea {
		flex: 1;
		resize: none;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 2px 6px;
		margin-left: -6px;
		max-height: 5em;
	}
	textarea:hover {
		border-color: var(--color-base-300);
	}
	textarea:focus {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	h1 {
		max-height: 5em;
		overflow-y: auto;
	}
	@media (max-width: 639px) {
		.claim-bar {
			padding: 12px 14px;
		}
		.claim-heading {
			flex-wrap: wrap;
			gap: 4px;
		}
		.claim-hint {
			flex-basis: 100%;
			font-size: 10px;
		}
		form {
			gap: 6px;
			flex-wrap: wrap;
		}
		textarea {
			flex-basis: 100%;
		}
		.claim-actions {
			margin-left: auto;
		}
	}
</style>
