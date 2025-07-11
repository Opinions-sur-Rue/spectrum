<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface ModalProps {
		toggle: boolean;
		onSubmit: (nickname: string, initialClaim?: string) => void;
	}

	let { toggle = $bindable(false), onSubmit }: ModalProps = $props();

	const modalId = 'create-modal';

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

	let nickname: string | undefined = $state();
	let initialClaim: string | undefined = $state();
</script>

<dialog id={modalId} class="modal">
	<div class="modal-box">
		<form method="dialog">
			<button
				class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2 hover:bg-rose-300"
				onclick={() => (toggle = false)}>✕</button
			>
		</form>
		<form class="p-4" onsubmit={() => nickname && onSubmit(nickname, initialClaim)}>
			<label
				class="label text-base-content font-bold after:ml-0.5 after:text-red-500 after:content-['*']"
				for="nickname2">{m.nickname()}</label
			>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder={m.placeholder_nickname()}
				bind:value={nickname}
				maxlength="16"
				id="nickname2"
				required
			/>
			<label class="label text-base-content font-bold" for="claim">{m.initial_claim()}</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder={m.placeholder_initial_claim()}
				id="claim"
				bind:value={initialClaim}
			/>
			<div>
				<button class="btn btn-success float-left" type="submit">{m.start_spectrum()}</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>{m.cancel()}</button
				>
			</div>
		</form>
	</div>
</dialog>
