<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { dialogFocus } from './dialog-focus';
	export interface Confirmation {
		op: string;
		payload: unknown;
		title: string;
		body: string;
	}
	let {
		action = $bindable(null),
		ready,
		send
	}: {
		action?: Confirmation | null;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		// A destructive confirmation must not silently re-arm after reconnect.
		if (!ready) action = null;
	});
	$effect(() => {
		if (action && dialog && !dialog.open) dialog.showModal();
	});
</script>

{#if action}
	<dialog
		use:dialogFocus
		bind:this={dialog}
		class="bg-base-100 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl p-6 break-words shadow-xl backdrop:bg-black/40"
		aria-labelledby="session-confirm-title"
		aria-describedby="session-confirm-body"
		oncancel={() => {
			action = null;
		}}
	>
		<h2 id="session-confirm-title" class="mb-3 text-lg font-semibold [overflow-wrap:anywhere]">
			{action.title}
		</h2>
		<p id="session-confirm-body" class="text-sm leading-relaxed">{action.body}</p>
		<div class="mt-5 flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="btn btn-ghost"
				onclick={() => {
					action = null;
				}}>{m.session_cancel()}</button
			>
			<button
				type="button"
				class="btn btn-error"
				data-testid="confirm-session-action"
				disabled={!ready}
				onclick={() => {
					if (action && send(action.op, action.payload)) action = null;
				}}>{m.session_confirm()}</button
			>
		</div>
	</dialog>
{/if}
