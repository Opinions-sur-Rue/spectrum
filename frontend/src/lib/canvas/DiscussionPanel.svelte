<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import ChatPanel from './ChatPanel.svelte';
	import ActivityPanel from './ActivityPanel.svelte';
	import TranscriptPanel from './TranscriptPanel.svelte';
	import type { ActivityEntry } from './activity-state';
	import type { RoomState } from './room-client';
	import type { ChatState, ChatError } from './chat-state';
	import type { TranscriptState } from './transcript-state';
	import { panelModality } from './panel-modality';
	let {
		room,
		ready,
		chat,
		chatError,
		activity,
		transcript,
		send,
		open = $bindable(false),
		// eslint-disable-next-line no-useless-assignment -- Bindable output consumed by the parent.
		unread = $bindable(0),
		onClose
	}: {
		room: RoomState;
		ready: boolean;
		chat: ChatState | null;
		chatError: ChatError | null;
		activity: ActivityEntry[];
		transcript: TranscriptState | null;
		send: (op: string, payload?: unknown) => boolean;
		open?: boolean;
		unread?: number;
		onClose: () => void;
	} = $props();
	const tabs = [
		{ id: 'chat', label: () => m.chat(), icon: 'chat' },
		{ id: 'activity', label: () => m.ux_tab_activity(), icon: 'history' },
		{ id: 'transcript', label: () => m.ux_tab_transcript(), icon: 'review' }
	] as const;
	let tab = $state<(typeof tabs)[number]['id']>('chat');
	let panel = $state<HTMLElement>();
	let compact = $state(false);
	onMount(() => {
		const media = window.matchMedia('(max-width: 1023px)');
		const update = () => (compact = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});
	let chatSeen = $state<number | null>(null);
	let activitySeen = $state<number | null>(null);
	let wasOpen = false;
	let wasModal = false;
	const newestActivity = $derived(activity.at(-1)?.id ?? 0);
	const chatUnread = $derived(
		chatSeen === null
			? 0
			: (chat?.messages.filter(
					(message) => message.id > chatSeen! && message.memberId !== room.userId
				).length ?? 0)
	);
	const activityUnread = $derived(
		activitySeen === null ? 0 : activity.filter((entry) => entry.id > activitySeen!).length
	);
	$effect(() => {
		if (chat && (chatSeen === null || (open && tab === 'chat'))) chatSeen = chat.sequence;
	});
	$effect(() => {
		if ((activitySeen === null && activity.length > 0) || (open && tab === 'activity'))
			activitySeen = newestActivity;
	});
	$effect(() => {
		unread = chatUnread;
	});
	$effect(() => {
		const modal = compact && open;
		if (open && (!wasOpen || (modal && !wasModal)))
			void tick().then(() => {
				if (open && !panel?.contains(document.activeElement))
					document.getElementById(`discussion-tab-${tab}`)?.focus();
			});
		wasOpen = open;
		wasModal = modal;
	});
	function close() {
		open = false;
		onClose();
	}
	function keyTab(event: KeyboardEvent, index: number) {
		let next: number;
		if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
		else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = tabs.length - 1;
		else return;
		event.preventDefault();
		tab = tabs[next].id;
		document.getElementById(`discussion-tab-${tab}`)?.focus();
	}
	function keepMobileFocus(event: KeyboardEvent) {
		if (!compact || !open || event.key !== 'Tab' || !panel) return;
		const controls = [
			...panel.querySelectorAll<HTMLElement>(
				'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'
			)
		].filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
		const first = controls[0];
		const last = controls.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
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
			!event.target.closest('[data-testid="discussion-toggle"]')
		)
			open = false;
	}}
/>

<aside
	use:panelModality={compact && open}
	bind:this={panel}
	id="room-discussion"
	class="discussion-panel"
	hidden={!open}
	aria-label={m.ux_discussion_title()}
	role={compact ? 'dialog' : undefined}
	aria-modal={compact && open ? true : undefined}
	onkeydown={keepMobileFocus}
	data-testid="discussion-panel"
>
	<header class="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
		<div>
			<h2 class="text-sm font-semibold">{m.ux_discussion_title()}</h2>
			<p class="mt-1 text-xs opacity-60">{m.ux_discussion_hint()}</p>
		</div>
		<IconButton
			icon="cancel"
			label={m.ux_close_discussion()}
			data-testid="discussion-close"
			onclick={close}
		/>
	</header>
	<div role="tablist" aria-label={m.ux_discussion_title()} class="discussion-tabs">
		{#each tabs as item, index (item.id)}
			{@const count = item.id === 'chat' ? chatUnread : item.id === 'activity' ? activityUnread : 0}
			<button
				id="discussion-tab-{item.id}"
				type="button"
				role="tab"
				aria-selected={tab === item.id}
				aria-controls="discussion-body-{item.id}"
				tabindex={tab === item.id ? 0 : -1}
				data-testid="discussion-tab-{item.id}"
				onclick={() => {
					tab = item.id;
				}}
				onkeydown={(event) => keyTab(event, index)}
			>
				<Icon name={item.icon} /><span>{item.label()}</span>
				{#if count}<span
						class="tab-count"
						aria-label={item.id === 'chat'
							? m.ux_chat_unread({ count: String(count) })
							: m.ux_activity_unread({ count: String(count) })}>{Math.min(count, 99)}</span
					>{/if}
			</button>
		{/each}
	</div>
	<!-- Keep all three bodies mounted: switching tabs or closing the panel must
	     never discard chat drafts, pending acknowledgments, or scroll position. -->
	<div
		id="discussion-body-chat"
		role="tabpanel"
		tabindex="0"
		aria-labelledby="discussion-tab-chat"
		class="discussion-body"
		hidden={tab !== 'chat'}
	>
		<ChatPanel {room} {ready} {chat} error={chatError} {send} active={open && tab === 'chat'} />
	</div>
	<div
		id="discussion-body-activity"
		role="tabpanel"
		tabindex="0"
		aria-labelledby="discussion-tab-activity"
		class="discussion-body"
		hidden={tab !== 'activity'}
	>
		<ActivityPanel entries={activity} active={open && tab === 'activity'} />
	</div>
	<div
		id="discussion-body-transcript"
		role="tabpanel"
		tabindex="0"
		aria-labelledby="discussion-tab-transcript"
		class="discussion-body"
		hidden={tab !== 'transcript'}
	>
		<TranscriptPanel
			{transcript}
			enabled={room.settings.transcriptionEnabled ?? false}
			workerReady={room.transcription?.ready ?? false}
			browserMode={room.transcription?.mode === 'browser'}
			localSpeakers={room.transcription?.speakers?.length ?? 0}
			stageMembers={room.members.filter((member) => member.role !== 'spectator').length}
			language={room.settings.transcriptionLanguage ?? 'fr'}
			{send}
			active={open && tab === 'transcript'}
		/>
	</div>
</aside>

<style>
	.discussion-panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: clamp(21rem, 30vw, 26rem);
		flex-shrink: 0;
		background: var(--color-base-100);
		border-left: 1px solid var(--color-base-300);
	}
	.discussion-panel[hidden],
	.discussion-body[hidden] {
		display: none;
	}
	.discussion-tabs {
		display: flex;
		gap: 4px;
		padding: 0 12px 10px;
		border-bottom: 1px solid var(--color-base-300);
	}
	.discussion-tabs button {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 40px;
		padding: 6px;
		border-radius: 8px;
		font-size: 12px;
		color: var(--color-base-content);
	}
	.discussion-tabs button:hover {
		background: var(--color-base-200);
	}
	.discussion-tabs button[aria-selected='true'] {
		background: color-mix(in oklab, var(--color-primary) 12%, transparent);
		color: var(--color-base-content);
		font-weight: 600;
	}
	.discussion-tabs button:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.tab-count {
		border-radius: 999px;
		padding: 0 5px;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-size: 10px;
	}
	.discussion-body {
		flex: 1;
		min-height: 0;
	}
	@media (max-width: 1023px) {
		.discussion-panel {
			position: fixed;
			z-index: 60;
			inset: 0;
			width: 100%;
			height: 100dvh;
			border: 1px solid var(--color-base-300);
			border-radius: 0;
			box-shadow: 0 -12px 36px #0002;
		}
		.discussion-tabs button,
		.discussion-panel :global(button.icon-button) {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
