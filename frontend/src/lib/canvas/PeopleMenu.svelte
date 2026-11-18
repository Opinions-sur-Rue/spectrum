<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	import { toolbarMenu } from './toolbar-menu';
	import { m } from '$lib/paraglide/messages.js';
	import ConfirmAction, { type Confirmation } from './ConfirmAction.svelte';
	import MemberAudio from './MemberAudio.svelte';
	import type { VoiceConnection } from './voice-connection';
	import { roleLabel } from './labels';
	import { formatSpeakingTime, speakingSecondsFor } from './speaking-time';
	import { panelModality, trapPanelFocus } from './panel-modality';
	let {
		room,
		ready,
		send,
		connection = null,
		speakers = [],
		speakingTime = {},
		onModalChange
	}: {
		room: RoomState;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
		connection?: VoiceConnection | null;
		speakers?: string[];
		speakingTime?: Record<string, number>;
		onModalChange?: (modal: boolean) => void;
	} = $props();
	let action = $state<Confirmation | null>(null);
	let nickname = $state('');
	let details: HTMLDetailsElement;
	let input: HTMLInputElement;
	let panel: HTMLDivElement;
	let open = $state(false);
	let compact = $state(false);
	$effect(() => {
		onModalChange?.(compact && open);
	});
	onMount(() => {
		const media = window.matchMedia('(max-width: 1023px)');
		const update = () => {
			compact = media.matches;
		};
		update();
		media.addEventListener('change', update);
		return () => {
			media.removeEventListener('change', update);
			onModalChange?.(false);
		};
	});
	export async function editNickname() {
		if (!details) return;
		details.open = true;
		await tick();
		input?.focus({ preventScroll: true });
	}
	function close() {
		if (!details) return;
		const trigger = details.querySelector('summary');
		details.open = false;
		open = false;
		void tick().then(() => {
			if (trigger?.isConnected) trigger.focus({ preventScroll: true });
		});
	}
	$effect(() => {
		if (compact && open)
			void tick().then(() => {
				if (details?.open && !panel?.contains(document.activeElement))
					panel.querySelector('button')?.focus({ preventScroll: true });
			});
	});
	const admin = $derived(room.role === 'admin');
	const members = $derived(room.members ?? []);
	const onStage = $derived(members.filter((member) => member.role !== 'spectator'));
	const spectators = $derived(members.filter((member) => member.role === 'spectator'));
	const own = $derived(members.find((member) => member.id === room.userId));
	const adminCount = $derived(members.filter((member) => member.role === 'admin').length);
	$effect(() => {
		if (!action) return;
		// Self-removal has no target member to re-validate.
		const targetId = (action.payload as { memberId?: string }).memberId;
		if (!targetId) {
			if (!admin) action = null;
			return;
		}
		const target = members.find((member) => member.id === targetId);
		if (
			!admin ||
			!target ||
			target.id === room.userId ||
			(action.op === 'room.appoint' && target.role !== 'participant')
		)
			action = null;
	});
	const hands = $derived(
		members
			.filter((member) => member.handRaisedAt)
			.toSorted((a, b) => a.handRaisedAt! - b.handRaisedAt! || a.id.localeCompare(b.id))
	);
</script>

<details
	bind:this={details}
	class="relative z-40"
	class:people-open={open}
	use:toolbarMenu={{ sheet: true, close }}
	ontoggle={() => {
		open = details.open;
	}}
>
	<summary class="toolbar-summary" aria-label={m.v2_people()} title={m.v2_people()}
		><Icon name="people" /><span class="text-xs">{members.length}</span>{#if hands.length}<span
				class="rounded-full bg-amber-100 px-1 text-[10px] text-amber-950"
				aria-hidden="true"
				title={m.social_hand_queue({ count: String(hands.length) })}>✋ {hands.length}</span
			>{/if}</summary
	>
	<div
		bind:this={panel}
		use:panelModality={compact && open}
		class="toolbar-popover people-panel bg-base-100 w-80 rounded-xl border shadow-xl"
		data-testid="people-panel"
		role={compact ? 'dialog' : undefined}
		aria-modal={compact && open ? true : undefined}
		aria-label={m.ux_people_title()}
		onkeydown={(event) => {
			if (compact && open) trapPanelFocus(panel, event);
		}}
	>
		<header class="people-heading">
			<h2>{m.ux_people_title()}</h2>
			<IconButton icon="cancel" label={m.ux_people_close()} onclick={close} />
		</header>
		<form
			class="profile-form"
			onsubmit={(event) => {
				event.preventDefault();
				if (ready && nickname.trim() && send('room.profile', { nickname: nickname.trim() }))
					nickname = '';
			}}
		>
			<label for="room-pseudonym">{m.v2_pseudonym()}</label>
			<p id="room-pseudonym-hint">{m.ux_profile_hint()}</p>
			<div class="profile-fields">
				<input
					bind:this={input}
					id="room-pseudonym"
					class="input input-sm min-w-0 flex-1"
					aria-describedby="room-pseudonym-hint"
					placeholder={own?.nickname ?? m.v2_pseudonym_placeholder()}
					maxlength="40"
					bind:value={nickname}
					disabled={!ready}
					autocomplete="nickname"
				/>
				<button
					type="submit"
					class="btn btn-sm"
					aria-label={m.v2_pseudonym_save()}
					disabled={!ready || !nickname.trim()}>{m.ux_profile_save()}</button
				>
			</div>
		</form>
		<div class="people-body">
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
								<span class="member-name min-w-0 flex-1">{member.nickname}</span
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
				{m.v2_stage({
					count: String(onStage.length),
					limit: String(room.settings.participantSlots)
				})}
			</h2>
			<ul class="space-y-1">
				{#each onStage as member (member.id)}
					<li
						class="member-row border-b py-2 text-sm"
						aria-label={member.nickname}
						data-member-id={member.id}
					>
						<div class="member-identity">
							<span
								class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
								style:background-color={member.color ? `#${member.color}` : 'gray'}
							></span>
							<span class="member-name" data-member-name={member.id}
								>{member.nickname}{member.id === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
							>
						</div>
						<div class="member-meta text-xs opacity-60">
							<span>{roleLabel(member.role)}</span>
							{#if speakingSecondsFor(member.id, member.speakingSeconds, speakingTime) > 0}
								{@const spoken = formatSpeakingTime(
									speakingSecondsFor(member.id, member.speakingSeconds, speakingTime)
								)}
								<span
									class="tabular-nums"
									data-speaking-time={member.id}
									title={m.voice_speaking_time_aria({ name: member.nickname, time: spoken })}
									>{spoken}</span
								>
							{/if}
						</div>
						{#if admin && (member.role === 'participant' || (member.id === room.userId && adminCount > 1))}
							<div class="member-actions" data-member-actions={member.id}>
								{#if admin && member.role === 'participant'}<IconButton
										icon="crown"
										label={m.v2_appoint_admin({ name: member.nickname })}
										disabled={!ready}
										onclick={() => {
											action = {
												op: 'room.appoint',
												payload: { memberId: member.id },
												title: m.v2_appoint_admin({ name: member.nickname }),
												body: m.v2_appoint_admin_body({ name: member.nickname })
											};
										}}
									/>{/if}
								{#if admin && member.id === room.userId && adminCount > 1}<IconButton
										icon="demote"
										label={m.v2_abdicate_admin()}
										disabled={!ready}
										onclick={() => {
											action = {
												op: 'room.abdicate',
												payload: {},
												title: m.v2_abdicate_admin(),
												body: m.v2_abdicate_admin_body()
											};
										}}
									/>{/if}
								{#if admin && member.role === 'participant' && room.voice?.available}<IconButton
										icon="micOff"
										label={m.voice_mute_member({ name: member.nickname })}
										disabled={!ready || !!member.microphoneMuted}
										onclick={() => send('voice.mute', { memberId: member.id })}
									/>{/if}
								{#if admin && member.role === 'participant'}<IconButton
										icon="demote"
										label={m.v2_demote({ name: member.nickname })}
										disabled={!ready}
										onclick={() => send('room.demote', { memberId: member.id })}
									/>{/if}
								{#if admin && member.role === 'participant'}
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
							</div>
						{/if}
						<MemberAudio
							{member}
							own={member.id === room.userId}
							{connection}
							speaking={speakers.includes(member.id)}
						/>
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
						class="member-row py-2 text-sm"
						aria-label={member.nickname}
						data-member-id={member.id}
					>
						<div class="member-identity">
							<span class="member-name" data-member-name={member.id}
								>{member.nickname}{member.id === room.userId ? ` ${m.ux_chat_you()}` : ''}</span
							>
						</div>
						{#if admin}
							<div class="member-actions" data-member-actions={member.id}>
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
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</div>
</details>
<ConfirmAction bind:action {ready} {send} />

<style>
	.people-open {
		z-index: 60;
	}
	.people-panel {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	.people-heading {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem 0.25rem;
	}
	.people-heading h2 {
		font-size: var(--v2-text-lg);
		font-weight: 650;
	}
	.profile-form {
		flex-shrink: 0;
		padding: 0.5rem 1rem 0.75rem;
		border-bottom: 1px solid var(--color-base-300);
	}
	.profile-form label {
		font-size: var(--v2-text-md);
		font-weight: 600;
	}
	.profile-form p {
		font-size: var(--v2-text-xs);
		opacity: 0.7;
		margin-block: 0.25rem 0.5rem;
	}
	.profile-fields {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.profile-fields input {
		width: 0;
	}
	.people-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.75rem 1rem;
	}
	.member-row {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;
	}
	.member-identity {
		display: flex;
		width: 100%;
		min-width: 0;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.member-name {
		min-width: 0;
		flex: 1;
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.member-meta,
	.member-actions {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	@media (max-width: 1023px) {
		.people-panel {
			border-radius: 0;
			padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
				env(safe-area-inset-left);
		}
		.people-panel :global(button),
		.profile-fields input {
			min-height: 44px;
		}
		.people-panel :global(.icon-button) {
			min-width: 44px;
		}
		.profile-fields input {
			font-size: max(1rem, 16px);
		}
	}
</style>
