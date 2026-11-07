<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { toolbarMenu } from './toolbar-menu';
	import ConfirmAction, { type Confirmation } from './ConfirmAction.svelte';
	let {
		admin,
		ready,
		send
	}: { admin: boolean; ready: boolean; send: (op: string, payload: unknown) => boolean } = $props();
	let action = $state<Confirmation | null>(null);
	$effect(() => {
		if (!admin && action?.op === 'room.stop') action = null;
	});
</script>

<details class="relative z-40" use:toolbarMenu>
	<summary class="toolbar-summary" aria-label={m.session_menu()} title={m.session_menu()}
		><Icon name="more" /></summary
	>
	<div class="toolbar-popover bg-base-100 w-64 space-y-2 rounded-xl border p-3 shadow-xl">
		<button
			type="button"
			class="btn btn-sm btn-ghost w-full justify-start"
			disabled={!ready}
			onclick={() => {
				action = {
					op: 'room.leave',
					payload: {},
					title: m.session_leave(),
					body: m.session_leave_body()
				};
			}}>{m.session_leave()}</button
		>
		{#if admin}<button
				type="button"
				class="btn btn-sm btn-ghost text-error w-full justify-start"
				disabled={!ready}
				onclick={() => {
					action = {
						op: 'room.stop',
						payload: {},
						title: m.session_stop(),
						body: m.session_stop_body()
					};
				}}>{m.session_stop()}</button
			>{/if}
	</div>
</details>
<ConfirmAction bind:action {ready} {send} />
