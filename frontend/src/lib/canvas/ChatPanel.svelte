<script lang="ts">
	import { tick } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	import {
		canWriteChannel,
		channelMessages,
		unreadInChannel,
		type ChatChannel,
		type ChatError,
		type ChatState
	} from './chat-state';
	import { m } from '$lib/paraglide/messages.js';
	import { roomErrorLabel } from './room-error-label';
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
	const empty = { room: '', stage: '', admin: '' } as const;
	const none = { room: null, stage: null, admin: null } as Record<ChatChannel, null>;
	let drafts = $state<Record<ChatChannel, string>>({ ...empty });
	let requests = $state<Record<ChatChannel, { id: string; text: string } | null>>({ ...none });
	let channel = $state<ChatChannel>('room');
	let confirming = $state<number | null>(null);
	let waiting = $state(false);
	let sticky = $state(true);
	let log = $state<HTMLDivElement>();
	let form = $state<HTMLFormElement>();
	let context = $state<HTMLDivElement>();
	const labels: Record<ChatChannel, () => string> = {
		room: () => m.chat_channel_room(),
		stage: () => m.chat_channel_stage(),
		admin: () => m.chat_channel_admin()
	};
	const hints: Record<ChatChannel, () => string> = {
		room: () =>
			room.settings.spectatorChatEnabled
				? m.chat_channel_room_open_hint()
				: m.chat_channel_room_hint(),
		stage: () => m.chat_channel_stage_hint(),
		admin: () => m.chat_channel_admin_hint()
	};
	const channels = $derived<ChatChannel[]>(
		room.role === 'admin'
			? ['room', 'stage', 'admin']
			: room.role === 'participant'
				? ['room', 'stage']
				: ['room']
	);
	// Losing access to a channel (demotion) must fall back to the shared room.
	$effect(() => {
		if (!channels.includes(channel)) channel = 'room';
	});
	$effect(() => {
		void channel;
		const failed = error;
		void tick().then(() => {
			if (context) context.scrollTop = failed ? context.scrollHeight : 0;
		});
	});
	const canWrite = $derived(
		canWriteChannel(room.role, channel, room.settings.spectatorChatEnabled)
	);
	const messages = $derived(channelMessages(chat, channel));
	const draft = $derived(drafts[channel]);
	const request = $derived(requests[channel]);
	let lastRead = $state<Record<ChatChannel, number | null>>({
		room: null,
		stage: null,
		admin: null
	});
	function unreadFor(item: ChatChannel) {
		if (item === channel) return 0;
		return unreadInChannel(chat, item, lastRead[item], room.userId);
	}
	$effect(() => {
		if (active && chat) lastRead[channel] = chat.messages.at(-1)?.id ?? -1;
	});
	$effect(() => {
		if (!ready || !canWrite) waiting = false;
		if (!request) return;
		if (error && (!error.requestId || error.requestId === request.id)) waiting = false;
		if (
			messages.some(
				(message) => message.memberId === room.userId && message.clientId === request.id
			)
		) {
			if (drafts[channel] === request.text) drafts[channel] = '';
			requests[channel] = null;
			waiting = false;
		}
	});
	$effect(() => {
		const count = messages.length;
		if (active && sticky && count)
			void tick().then(() => {
				if (log) log.scrollTop = log.scrollHeight;
			});
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = drafts[channel].trim();
		if (!ready || !canWrite || waiting || !text || [...text].length > 1000) return;
		const pending = requests[channel];
		const id = pending?.text === text ? pending.id : crypto.randomUUID();
		requests[channel] = { id, text };
		waiting = send('chat.send', { text, clientId: id, channel });
	}
	function remove(messageId: number) {
		if (!ready || confirming !== messageId) return;
		confirming = null;
		send('chat.remove', { messageId });
	}
</script>

<section id="room-chat" aria-label={m.ux_chat_room()} class="flex h-full min-h-0 min-w-0 flex-col">
	<div class="chat-context" bind:this={context}>
		{#if channels.length > 1}
			<div
				class="chat-channels flex gap-1 border-b px-2 py-2"
				role="group"
				aria-label={m.chat_channel_group()}
			>
				{#each channels as item (item)}
					<button
						type="button"
						class="btn btn-sm min-h-11 flex-1"
						class:btn-primary={channel === item}
						class:btn-ghost={channel !== item}
						aria-pressed={channel === item}
						data-testid="chat-channel-{item}"
						onclick={() => {
							channel = item;
							confirming = null;
						}}
						>{labels[item]()}{#if unreadFor(item)}<span
								class="bg-error text-error-contrast rounded-full px-1.5 text-[10px]"
								aria-label={m.ux_chat_unread({ count: String(unreadFor(item)) })}
								>{unreadFor(item)}</span
							>{/if}</button
					>{/each}
			</div>
		{/if}
		<p
			id="chat-audience"
			class="chat-hint border-b px-4 py-2 text-xs opacity-75"
			data-testid="chat-channel-hint"
			aria-live="polite"
		>
			{hints[channel]()}
		</p>
		<p class="px-3 pb-2 text-[10px] opacity-75">{m.ux_chat_footer()}</p>
		{#if error}<p role="alert" class="text-error px-3 pb-2 text-xs">
				{roomErrorLabel(error.message)}
			</p>{/if}
		{#if !canWrite}<p class="border-t px-3 py-2 text-xs opacity-60">
				{m.ux_chat_readonly()}
			</p>{/if}
	</div>
	<div
		bind:this={log}
		role="log"
		aria-label={m.ux_chat_messages()}
		aria-live="polite"
		class="chat-messages min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm"
		onscroll={() => {
			if (log) sticky = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
		}}
	>
		{#each messages as message (message.id)}
			<div data-chat-id={message.id} class="break-words">
				<span class="text-xs font-semibold"
					>{message.nickname}{message.memberId === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
				>
				{#if message.removed}
					<p class="text-xs italic opacity-60" data-chat-removed={message.id}>
						{m.chat_removed_message()}
					</p>
				{:else}
					<p class="whitespace-pre-wrap">{message.text}</p>
				{/if}
				{#if room.role === 'admin' && !message.removed}<span
						class="chat-actions inline-flex items-center gap-1"
					>
						{#if confirming === message.id}<button
								type="button"
								class="btn btn-error btn-xs min-h-11"
								data-testid="chat-remove-confirm"
								onclick={() => remove(message.id)}>{m.chat_remove_confirm()}</button
							><button
								type="button"
								class="btn btn-ghost btn-xs min-h-11"
								onclick={() => {
									confirming = null;
								}}>{m.session_cancel()}</button
							>{:else}<IconButton
								icon="trash"
								label={m.chat_remove()}
								disabled={!ready}
								onclick={() => {
									confirming = message.id;
								}}
							/>{/if}
					</span>{/if}
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
	<form
		bind:this={form}
		class="chat-form flex min-w-0 shrink-0 items-end gap-2 border-t p-2"
		onsubmit={submit}
	>
		<textarea
			aria-label={m.ux_chat_message_label()}
			aria-describedby="chat-audience"
			class="textarea min-h-12 min-w-0 flex-1 text-sm"
			rows="2"
			maxlength="1000"
			bind:value={drafts[channel]}
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
</section>

<style>
	.chat-context {
		display: flex;
		flex-direction: column;
		flex-shrink: 1;
		min-height: 44px;
		max-height: 45%;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.chat-context > :global(*) {
		flex-shrink: 0;
	}
	.chat-messages {
		overscroll-behavior: contain;
		overflow-wrap: anywhere;
	}
	.chat-form textarea {
		width: 0;
		resize: none;
		max-height: 8rem;
	}
	.chat-actions {
		margin-left: 0.25rem;
		vertical-align: middle;
	}
	.chat-hint {
		order: -1;
		flex-shrink: 0;
		overflow-wrap: anywhere;
	}
	@media (max-width: 1023px) {
		.chat-form textarea {
			font-size: max(1rem, 16px);
		}
		.chat-form :global(button) {
			min-width: 44px;
			min-height: 44px;
		}
		.chat-channels :global(button) {
			min-height: 44px;
		}
	}
</style>
