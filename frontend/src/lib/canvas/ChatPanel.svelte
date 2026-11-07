<script lang="ts">
	import { tick } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	import type { ChatState, ChatError } from './chat-state';
	import { m } from '$lib/paraglide/messages.js';
	let {
		room,
		ready,
		chat,
		error,
		send,
		active = true
	}: {
		room: RoomState;
		ready: boolean;
		chat: ChatState | null;
		error: ChatError | null;
		send: (op: string, payload: unknown) => boolean;
		active?: boolean;
	} = $props();
	let draft = $state('');
	let request = $state<{ id: string; text: string } | null>(null);
	let waiting = $state(false);
	let sticky = $state(true);
	let log = $state<HTMLDivElement>();
	let form = $state<HTMLFormElement>();
	const canWrite = $derived(room.role !== 'spectator' || room.settings.spectatorChatEnabled);
	const messages = $derived(chat?.messages ?? []);
	$effect(() => {
		if (!ready || !canWrite) waiting = false;
		if (request && error && (!error.requestId || error.requestId === request.id)) waiting = false;
		if (
			request &&
			messages.some(
				(message) => message.memberId === room.userId && message.clientId === request?.id
			)
		) {
			if (draft.trim() === request.text) draft = '';
			request = null;
			waiting = false;
		}
	});
	$effect(() => {
		const sequence = chat?.sequence;
		if (active && sticky && sequence !== undefined)
			void tick().then(() => {
				if (log) log.scrollTop = log.scrollHeight;
			});
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!ready || !canWrite || waiting || !text || [...text].length > 1000) return;
		const id = request?.text === text ? request.id : crypto.randomUUID();
		request = { id, text };
		waiting = send('chat.send', { text, clientId: id });
	}
</script>

<section id="room-chat" aria-label={m.ux_chat_room()} class="flex h-full min-h-0 flex-col">
	<div
		bind:this={log}
		role="log"
		aria-label={m.ux_chat_messages()}
		aria-live="polite"
		class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm"
		onscroll={() => {
			if (log) sticky = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
		}}
	>
		{#each messages as message (message.id)}
			<div data-chat-id={message.id} class="break-words">
				<span class="text-xs font-semibold"
					>{message.nickname}{message.memberId === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
				>
				<p class="whitespace-pre-wrap">{message.text}</p>
			</div>
		{:else}<p class="text-xs opacity-60">
				{chat ? m.ux_chat_empty() : m.ux_chat_loading()}
			</p>{/each}
	</div>
	{#if !sticky && messages.length}<button
			type="button"
			class="btn btn-sm mx-3 my-1 min-h-11"
			onclick={() => {
				sticky = true;
				if (log) log.scrollTop = log.scrollHeight;
			}}>{m.ux_latest_messages()}</button
		>{/if}
	{#if error}<p role="alert" class="text-error px-3 pb-2 text-xs">{error.message}</p>{/if}
	{#if !canWrite}<p class="border-t px-3 py-2 text-xs opacity-60">
			{m.ux_chat_readonly()}
		</p>{/if}
	<form bind:this={form} class="flex items-end gap-2 border-t p-2" onsubmit={submit}>
		<textarea
			aria-label={m.ux_chat_message_label()}
			class="textarea min-h-12 min-w-0 flex-1 text-sm"
			rows="2"
			maxlength="1000"
			bind:value={draft}
			disabled={!ready || !canWrite}
			placeholder={canWrite ? m.ux_chat_placeholder() : m.ux_chat_readonly_placeholder()}
			onkeydown={(event) => {
				if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
					event.preventDefault();
					form?.requestSubmit();
				}
			}}
		></textarea>
		<IconButton
			icon="send"
			label={m.ux_chat_send()}
			type="submit"
			disabled={!ready || !canWrite || waiting || !draft.trim()}
		/>
	</form>
	<p class="px-3 pb-2 text-[10px] opacity-75">{m.ux_chat_footer()}</p>
</section>
