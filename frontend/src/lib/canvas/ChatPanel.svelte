<script lang="ts">
	import { tick } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	import type { ChatState, ChatError } from './chat-state';
	let {
		room,
		ready,
		chat,
		error,
		send
	}: {
		room: RoomState;
		ready: boolean;
		chat: ChatState | null;
		error: ChatError | null;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let open = $state(false);
	let draft = $state('');
	let request = $state<{ id: string; text: string } | null>(null);
	let waiting = $state(false);
	let lastSeen = $state<number | null>(null);
	let sticky = $state(true);
	let log = $state<HTMLDivElement>();
	let form = $state<HTMLFormElement>();
	const canWrite = $derived(room.role !== 'spectator' || room.settings.spectatorChatEnabled);
	const messages = $derived(chat?.messages ?? []);
	const unread = $derived(
		lastSeen === null
			? 0
			: messages.filter((message) => message.id > lastSeen! && message.memberId !== room.userId)
					.length
	);

	$effect(() => {
		if (chat && (lastSeen === null || open)) lastSeen = chat.sequence;
	});
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
		if (open && sticky && sequence !== undefined)
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

<div class="relative z-20">
	<IconButton
		icon="chat"
		label="Chat"
		aria-expanded={open}
		aria-controls="room-chat"
		onclick={() => {
			open = !open;
			sticky = true;
		}}
	/>
	{#if unread && !open}<span
			class="bg-primary text-primary-content pointer-events-none absolute -top-1 -right-1 rounded-full px-1 text-[10px]"
			aria-label="{unread} unread messages">{Math.min(99, unread)}</span
		>{/if}
	{#if open}
		<section
			id="room-chat"
			aria-label="Room chat"
			class="bg-base-100 absolute top-full right-0 mt-2 flex max-h-[70dvh] w-80 max-w-[90vw] flex-col rounded border shadow-lg"
		>
			<div class="flex items-center justify-between border-b px-3 py-2">
				<h2 class="text-sm font-semibold">Chat</h2>
				<IconButton
					icon="cancel"
					label="Close chat"
					onclick={() => {
						open = false;
					}}
				/>
			</div>
			<div
				bind:this={log}
				role="log"
				aria-label="Chat messages"
				aria-live="polite"
				class="min-h-20 flex-1 space-y-3 overflow-y-auto p-3 text-sm"
				onscroll={() => {
					if (log) sticky = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
				}}
			>
				{#each messages as message (message.id)}
					<div data-chat-id={message.id} class="break-words">
						<span class="text-xs font-semibold"
							>{message.nickname}{message.memberId === room.userId ? ' (you)' : ''}</span
						>
						<p class="whitespace-pre-wrap">{message.text}</p>
					</div>
				{:else}<p class="text-xs opacity-60">
						{chat ? 'No messages yet.' : 'Loading messages…'}
					</p>{/each}
			</div>
			{#if error}<p role="alert" class="text-error px-3 pb-2 text-xs">{error.message}</p>{/if}
			{#if !canWrite}<p class="border-t px-3 py-2 text-xs opacity-60">
					Read-only. The admin can enable spectator chat.
				</p>{/if}
			<form bind:this={form} class="flex items-end gap-2 border-t p-2" onsubmit={submit}>
				<textarea
					aria-label="Chat message"
					class="textarea min-h-12 min-w-0 flex-1 text-sm"
					rows="2"
					maxlength="1000"
					bind:value={draft}
					disabled={!ready || !canWrite}
					placeholder={canWrite ? 'Message…' : 'Read-only'}
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
							event.preventDefault();
							form?.requestSubmit();
						}
					}}
				></textarea>
				<IconButton
					icon="send"
					label="Send message"
					type="submit"
					disabled={!ready || !canWrite || waiting || !draft.trim()}
				/>
			</form>
			<p class="px-3 pb-2 text-[10px] opacity-50">Last 100 messages · memory only</p>
		</section>
	{/if}
</div>
