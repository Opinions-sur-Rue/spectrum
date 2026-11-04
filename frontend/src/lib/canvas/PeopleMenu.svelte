<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState } from './room-client';
	let {
		room,
		ready,
		send
	}: { room: RoomState; ready: boolean; send: (op: string, payload: unknown) => void } = $props();
	let nickname = $state('');
	const admin = $derived(room.role === 'admin');
	const members = $derived(room.members ?? []);
	const onStage = $derived(members.filter((member) => member.role !== 'spectator'));
	const spectators = $derived(members.filter((member) => member.role === 'spectator'));
	const own = $derived(members.find((member) => member.id === room.userId));
</script>

<details class="relative z-10">
	<summary class="btn btn-sm btn-ghost" aria-label="People" title="People"
		><Icon name="people" /><span class="text-xs">{members.length}</span></summary
	>
	<div
		class="bg-base-100 absolute right-0 mt-1 max-h-[65dvh] w-72 overflow-y-auto rounded border p-3 shadow"
		data-testid="people-panel"
	>
		<h2 class="mb-2 text-sm font-semibold">
			On stage ({onStage.length}/{room.settings.participantSlots})
		</h2>
		<ul class="space-y-1">
			{#each onStage as member (member.id)}
				<li
					class="flex items-center gap-2 text-sm"
					aria-label={member.nickname}
					data-member-id={member.id}
				>
					<span
						class="h-2 w-2 rounded-full"
						style:background-color={member.color ? `#${member.color}` : 'gray'}
					></span>
					<span class="min-w-0 flex-1 truncate"
						>{member.nickname}{member.id === room.userId ? ' (you)' : ''}</span
					>
					<span class="text-xs opacity-60">{member.role}</span>
					{#if admin && member.role === 'participant'}<IconButton
							icon="demote"
							label="Demote {member.nickname}"
							disabled={!ready}
							onclick={() => send('room.demote', { memberId: member.id })}
						/>{/if}
				</li>
			{/each}
		</ul>
		<h2 class="mt-3 mb-2 text-sm font-semibold">
			Spectators ({spectators.length}/{room.settings.spectatorLimit})
		</h2>
		<ul class="space-y-1">
			{#each spectators as member (member.id)}
				<li
					class="flex items-center gap-2 text-sm"
					aria-label={member.nickname}
					data-member-id={member.id}
				>
					<span class="min-w-0 flex-1 truncate"
						>{member.nickname}{member.id === room.userId ? ' (you)' : ''}</span
					>
					{#if admin}<IconButton
							icon="promote"
							label="Promote {member.nickname}"
							disabled={!ready || onStage.length >= room.settings.participantSlots}
							onclick={() => send('room.promote', { memberId: member.id })}
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
				aria-label="Your pseudonym"
				placeholder={own?.nickname ?? 'Pseudonym'}
				maxlength="40"
				bind:value={nickname}
			/>
			<IconButton
				icon="check"
				label="Save pseudonym"
				type="submit"
				disabled={!ready || !nickname.trim()}
			/>
		</form>
	</div>
</details>
