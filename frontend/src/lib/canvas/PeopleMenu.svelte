<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	import { toolbarMenu } from './toolbar-menu';
	import { m } from '$lib/paraglide/messages.js';
	import ConfirmAction, { type Confirmation } from './ConfirmAction.svelte';
	import MemberAudio from './MemberAudio.svelte';
	import type { VoiceConnection } from './voice-connection';
	import { roleLabel } from './labels';
	let {
		room,
		ready,
		send,
		connection = null,
		speakers = []
	}: {
		room: RoomState;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
		connection?: VoiceConnection | null;
		speakers?: string[];
	} = $props();
	let action = $state<Confirmation | null>(null);
	let nickname = $state('');
	const admin = $derived(room.role === 'admin');
	const members = $derived(room.members ?? []);
	const onStage = $derived(members.filter((member) => member.role !== 'spectator'));
	const spectators = $derived(members.filter((member) => member.role === 'spectator'));
	const own = $derived(members.find((member) => member.id === room.userId));
	$effect(() => {
		if (!action) return;
		const targetId = (action.payload as { memberId: string }).memberId;
		const target = members.find((member) => member.id === targetId);
		if (
			!admin ||
			!target ||
			target.id === room.userId ||
			(action.op === 'room.transfer' && target.role !== 'participant')
		)
			action = null;
	});
	const hands = $derived(
		members
			.filter((member) => member.handRaisedAt)
			.toSorted((a, b) => a.handRaisedAt! - b.handRaisedAt! || a.id.localeCompare(b.id))
	);
</script>

<details class="relative z-40" use:toolbarMenu>
	<summary class="toolbar-summary" aria-label={m.v2_people()} title={m.v2_people()}
		><Icon name="people" /><span class="text-xs">{members.length}</span>{#if hands.length}<span
				class="rounded-full bg-amber-100 px-1 text-[10px] text-amber-950"
				aria-hidden="true"
				title={m.social_hand_queue({ count: String(hands.length) })}>✋ {hands.length}</span
			>{/if}</summary
	>
	<div
		class="toolbar-popover bg-base-100 w-80 overflow-y-auto rounded-xl border p-4 shadow-xl"
		data-testid="people-panel"
	>
		{#if hands.length}<section
				class="mb-4 rounded-lg border p-2"
				data-testid="hand-queue"
				aria-label={m.social_hand_queue({ count: String(hands.length) })}
			>
				<h2 class="mb-2 text-xs font-semibold">
					✋ {m.social_hand_queue({ count: String(hands.length) })}
				</h2>
				<ol>
					{#each hands as member (member.id)}<li
							class="flex items-center gap-2 text-xs"
							data-hand-member={member.id}
						>
							<span class="min-w-0 flex-1 truncate">{member.nickname}</span
							>{#if admin || member.id === room.userId}<IconButton
									icon="demote"
									label={m.social_lower_member_hand({ name: member.nickname })}
									disabled={!ready}
									onclick={() => send('room.hand', { memberId: member.id, raised: false })}
								/>{/if}
						</li>{/each}
				</ol>
			</section>{/if}
		<h2 class="mb-2 text-sm font-semibold">
			{m.v2_stage({ count: String(onStage.length), limit: String(room.settings.participantSlots) })}
		</h2>
		<ul class="space-y-1">
			{#each onStage as member (member.id)}
				<li
					class="flex flex-wrap items-center gap-2 border-b py-2 text-sm"
					aria-label={member.nickname}
					data-member-id={member.id}
				>
					<span
						class="h-2 w-2 rounded-full"
						style:background-color={member.color ? `#${member.color}` : 'gray'}
					></span>
					<span class="min-w-0 flex-1 truncate"
						>{member.nickname}{member.id === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
					>
					<span class="text-xs opacity-60">{roleLabel(member.role)}</span>
					{#if admin && member.role === 'participant'}<IconButton
							icon="demote"
							label={m.v2_demote({ name: member.nickname })}
							disabled={!ready}
							onclick={() => send('room.demote', { memberId: member.id })}
						/>{/if}
					{#if admin && member.role === 'participant'}
						<IconButton
							icon="people"
							label={m.session_transfer({ name: member.nickname })}
							disabled={!ready}
							onclick={() => {
								action = {
									op: 'room.transfer',
									payload: { memberId: member.id },
									title: m.session_transfer({ name: member.nickname }),
									body: m.session_transfer_body({ name: member.nickname })
								};
							}}
						/>
						<IconButton
							icon="trash"
							label={m.session_kick({ name: member.nickname })}
							disabled={!ready}
							onclick={() => {
								action = {
									op: 'room.kick',
									payload: { memberId: member.id },
									title: m.session_kick({ name: member.nickname }),
									body: m.session_kick_body({ name: member.nickname })
								};
							}}
						/>
					{/if}
					<div class="w-full">
						<MemberAudio
							{member}
							own={member.id === room.userId}
							{connection}
							speaking={speakers.includes(member.id)}
						/>
					</div>
				</li>
			{/each}
		</ul>
		<h2 class="mt-3 mb-2 text-sm font-semibold">
			{m.v2_spectators({
				count: String(spectators.length),
				limit: String(room.settings.spectatorLimit)
			})}
		</h2>
		<ul class="space-y-1">
			{#each spectators as member (member.id)}
				<li
					class="flex items-center gap-2 text-sm"
					aria-label={member.nickname}
					data-member-id={member.id}
				>
					<span class="min-w-0 flex-1 truncate"
						>{member.nickname}{member.id === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
					>
					{#if admin}<IconButton
							icon="promote"
							label={m.v2_promote({ name: member.nickname })}
							disabled={!ready || onStage.length >= room.settings.participantSlots}
							onclick={() => send('room.promote', { memberId: member.id })}
						/>{/if}
					{#if admin}<IconButton
							icon="trash"
							label={m.session_kick({ name: member.nickname })}
							disabled={!ready}
							onclick={() => {
								action = {
									op: 'room.kick',
									payload: { memberId: member.id },
									title: m.session_kick({ name: member.nickname }),
									body: m.session_kick_body({ name: member.nickname })
								};
							}}
						/>{/if}
				</li>
			{/each}
		</ul>
		<form
			class="mt-4 flex gap-1 border-t pt-2"
			onsubmit={(event) => {
				event.preventDefault();
				send('room.profile', { nickname: nickname.trim() });
				nickname = '';
			}}
		>
			<input
				class="input input-sm min-w-0 flex-1"
				aria-label={m.v2_pseudonym()}
				placeholder={own?.nickname ?? m.v2_pseudonym_placeholder()}
				maxlength="40"
				bind:value={nickname}
			/>
			<IconButton
				icon="check"
				label={m.v2_pseudonym_save()}
				type="submit"
				disabled={!ready || !nickname.trim()}
			/>
		</form>
	</div>
</details>
<ConfirmAction bind:action {ready} {send} />
