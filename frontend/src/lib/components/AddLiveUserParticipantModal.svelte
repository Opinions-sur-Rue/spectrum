<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { LiveUser } from '$lib/social';
	import { faPlus } from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';

	interface ModalProps {
		toggle: boolean;
		liveUsers: Map<string, LiveUser>;
		onSubmit: (liveUserId: string, liveUserNickname: string, liveUserPictureUrl?: string) => void;
	}

	let { toggle = $bindable(false), liveUsers = $bindable(), onSubmit }: ModalProps = $props();

	const modalId = 'add-live-user';

	$effect(() => {
		const el = document.getElementById(modalId);
		if (el instanceof HTMLDialogElement) {
			if (toggle) {
				el.show();
			} else {
				el.close();
			}
		}
	});

	let selectedUserId: string | undefined = $state();
	let search: string | undefined = $state();

	const filteredUsers = $derived(() => {
		const query = search?.toLowerCase().trim();
		if (!query) return Array.from(liveUsers.values());
		return Array.from(liveUsers.values()).filter((user) =>
			user.nickname.toLowerCase().includes(query)
		);
	});

	$effect(() => {
		if (toggle) search = '';
	});
</script>

<dialog id={modalId} class="modal">
	<div class="modal-box">
		<form method="dialog">
			<button
				class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2 hover:bg-rose-300"
				onclick={() => (toggle = false)}>✕</button
			>
		</form>
		<form
			class="p-4"
			onsubmit={() =>
				selectedUserId &&
				liveUsers.has(selectedUserId) &&
				onSubmit(
					selectedUserId,
					liveUsers.get(selectedUserId)!.nickname,
					liveUsers.get(selectedUserId)!.profilePictureUrl
				)}
		>
			<p class="mb-4 text-sm">{m.search_participants()}</p>

			<label class="input w-full">
				<svg class="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
					<g
						stroke-linejoin="round"
						stroke-linecap="round"
						stroke-width="2.5"
						fill="none"
						stroke="currentColor"
					>
						<circle cx="11" cy="11" r="8"></circle>
						<path d="m21 21-4.3-4.3"></path>
					</g>
				</svg>
				<input type="search" bind:value={search} placeholder="Search" class="grow" />
			</label>

			<!-- Filtered list of users-->
			<ul class="my-4 max-h-60 min-h-30 space-y-2 overflow-y-auto rounded-sm">
				{#each filteredUsers() as user (user.userId)}
					<li class="relative">
						<button
							type="button"
							class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
						>
							<img
								src={user.profilePictureUrl ?? '/default-avatar.png'}
								alt="avatar"
								class="h-8 w-8 rounded-full"
							/>
							<span>{user.nickname}</span>
						</button>
						<div class="tooltip tooltip-left absolute top-1 right-1" data-tip={m.add_participant()}>
							<button
								class="btn btn-circle"
								onclick={() => (selectedUserId = user.userId)}
								type="submit"><Fa icon={faPlus} /></button
							>
						</div>
					</li>
				{:else}
					<li>
						<div class="skeleton h-12 w-full"></div>
					</li>
					<li>
						<div class="skeleton h-12 w-full"></div>
					</li>
					<li>
						<div class="skeleton h-12 w-full"></div>
					</li>
				{/each}
			</ul>

			<div>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>{m.close()}</button
				>
			</div>
		</form>
	</div>
</dialog>
