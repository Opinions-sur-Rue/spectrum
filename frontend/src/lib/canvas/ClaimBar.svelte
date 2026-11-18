<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import { dialogFocus } from './dialog-focus';
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
	let input = $state<HTMLInputElement>();
	let editButton = $state<HTMLButtonElement>();
	let contextRoom = $state('');
	let composing = $state(false);
	let reading = $state<{ roomId: string; topic: string } | null>(null);
	let dialog = $state<HTMLDialogElement>();
	const singleLine = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ');
	let displayTopic = $derived(singleLine(spectrum?.topic ?? ''));
	let canRead = $derived(
		reading !== null && reading.roomId === room.roomId && reading.topic === spectrum?.topic
	);
	$effect(() => {
		if (contextRoom !== room.roomId) {
			contextRoom = room.roomId;
			topic = singleLine(spectrum?.topic ?? '');
			dirty = false;
			editing = false;
			composing = false;
		}
	});
	$effect(() => {
		if (reading && !canRead) reading = null;
		if (canRead && dialog && !dialog.open) dialog.showModal();
	});
	$effect(() => {
		if (editing) void tick().then(() => input?.focus());
	});
	$effect(() => {
		if (room.role !== 'admin' || presentation) {
			topic = singleLine(spectrum?.topic ?? '');
			dirty = false;
			editing = false;
			composing = false;
		}
	});
	$effect(() => {
		if (spectrum && (!dirty || singleLine(spectrum.topic) === topic)) {
			topic = singleLine(spectrum.topic);
			dirty = false;
		}
	});
	function cancel() {
		topic = singleLine(spectrum?.topic ?? '');
		dirty = false;
		finishEditing();
	}
	function finishEditing() {
		editing = false;
		composing = false;
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
				if (
					ready &&
					room.role === 'admin' &&
					!presentation &&
					!composing &&
					send('spectrum.topic', { topic: singleLine(topic) })
				)
					finishEditing();
			}}
		>
			<input
				type="text"
				bind:this={input}
				aria-label={m.ux_current_claim()}
				data-testid="claim-input"
				placeholder={m.ux_claim_placeholder()}
				maxlength="500"
				disabled={!ready}
				bind:value={topic}
				oninput={() => {
					dirty = true;
				}}
				oncompositionstart={() => (composing = true)}
				oncompositionend={() => (composing = false)}
				onpaste={(event) => {
					const pasted = event.clipboardData?.getData('text/plain');
					if (pasted === undefined) return;
					event.preventDefault();
					const field = event.currentTarget;
					const start = field.selectionStart ?? topic.length;
					const end = field.selectionEnd ?? start;
					const inserted = singleLine(pasted).slice(
						0,
						Math.max(0, 500 - topic.length + end - start)
					);
					topic = topic.slice(0, start) + inserted + topic.slice(end);
					dirty = true;
					void tick().then(() =>
						field.setSelectionRange(start + inserted.length, start + inserted.length)
					);
				}}
				onkeydown={(event) => {
					if (event.isComposing || composing || event.keyCode === 229) {
						if (event.key === 'Enter') event.preventDefault();
						return;
					}
					if (event.key === 'Escape') {
						event.preventDefault();
						cancel();
					}
					if (event.key === 'Enter') {
						event.preventDefault();
						form?.requestSubmit();
					}
				}}
			/>
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
			<h1>
				{#if displayTopic}<button
						class="claim-read"
						type="button"
						aria-label={`${m.ux_read_full_claim()}: ${displayTopic}`}
						title={m.ux_read_full_claim()}
						onclick={() => (reading = { roomId: room.roomId, topic: spectrum?.topic ?? '' })}
						>{displayTopic}</button
					>{:else}{m.ux_no_claim()}{/if}
			</h1>
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

{#if canRead}<dialog
		use:dialogFocus
		bind:this={dialog}
		class="claim-dialog bg-base-100 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40"
		aria-labelledby="claim-read-title"
		oncancel={() => (reading = null)}
		onclose={() => (reading = null)}
	>
		<h2 id="claim-read-title" class="mb-3 text-lg font-semibold">{m.ux_current_claim()}</h2>
		<p>{displayTopic}</p>
		<div class="mt-4 flex justify-end">
			<button type="button" class="btn btn-ghost" onclick={() => (reading = null)}
				>{m.close()}</button
			>
		</div>
	</dialog>{/if}

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
		justify-content: center;
		text-align: center;
	}
	.claim-eyebrow {
		font-size: var(--v2-text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-weight: 700;
		opacity: 0.75;
	}
	.claim-hint {
		font-size: var(--v2-text-xs);
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
		align-items: center;
		gap: 8px;
	}
	.claim-display > button {
		flex-shrink: 0;
	}
	input,
	h1 {
		min-width: 0;
		width: 100%;
		margin: 0;
		font-size: clamp(16px, 1.6vw, 22px);
		font-weight: 600;
		line-height: 1.45;
		background: transparent;
		text-align: center;
		white-space: nowrap;
	}
	input {
		flex: 1;
		border: 1px solid transparent;
		border-radius: var(--v2-radius-sm);
		padding: 2px 6px;
		margin-left: -6px;
	}
	input:hover {
		border-color: var(--color-base-300);
	}
	input:focus,
	.claim-read:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	h1 {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.claim-read {
		display: block;
		width: 100%;
		padding: 2px;
		border: 0;
		background: transparent;
		font: inherit;
		text-align: inherit;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.claim-dialog p {
		overflow-wrap: anywhere;
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
			font-size: var(--v2-text-2xs);
		}
		form {
			gap: 6px;
			flex-wrap: wrap;
		}
		input {
			flex-basis: 100%;
		}
		.claim-actions {
			margin-left: auto;
		}
	}
</style>
