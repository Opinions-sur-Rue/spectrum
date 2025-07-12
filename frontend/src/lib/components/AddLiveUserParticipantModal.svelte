<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { LiveUser } from '$lib/social';

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
	let search: string = $state('');

	const filteredUsers = $derived(() => {
		const query = search.toLowerCase().trim();
		if (!query) return Array.from(liveUsers.values());
		return Array.from(liveUsers.values()).filter((user) =>
			user.nickname.toLowerCase().includes(query)
		);
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
			<label class="input">
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
				<input type="search" bind:value={search} required placeholder="Search" class="grow" />
			</label>

			<!-- Filtered list of users-->
			<ul class="mb-4 max-h-60 space-y-2 overflow-y-auto">
				{#each filteredUsers() as user (user.userId)}
					<li>
						<button
							type="button"
							onclick={() => (selectedUserId = user.userId)}
							class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
							class:selected={selectedUserId === user.userId}
						>
							<img
								src={user.profilePictureUrl ?? '/default-avatar.png'}
								alt="avatar"
								class="h-8 w-8 rounded-full"
							/>
							<span>{user.nickname}</span>
						</button>
					</li>
				{/each}
			</ul>

			<div>
				<button class="btn btn-success float-left" type="submit">{m.start_connection()}</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>{m.cancel()}</button
				>
			</div>
		</form>
	</div>
</dialog>
