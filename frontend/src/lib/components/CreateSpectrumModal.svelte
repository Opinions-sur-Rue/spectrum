<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface ModalProps {
		toggle: boolean;
		onSubmit: (nickname: string, initialClaim?: string, showNeutralCircle?: boolean) => void;
	}

	let { toggle = $bindable(false), onSubmit }: ModalProps = $props();

	const modalId = 'create-modal';

	$effect(() => {
		const el = document.getElementById(modalId);
		if (el instanceof HTMLDialogElement) {
			if (toggle) {
				el.showModal();
			} else {
				el.close();
			}
		}
	});

	let nickname: string | undefined = $state();
	let initialClaim: string | undefined = $state();
	let showNeutralCircle: boolean = $state(true);
	let errors = $state({ nickname: false });

	function handleSubmit() {
		errors.nickname = !nickname?.trim();
		if (!errors.nickname) {
			onSubmit(nickname!, initialClaim, showNeutralCircle);
		}
	}
</script>

<dialog id={modalId} class="modal">
	<div class="modal-box">
		<form method="dialog">
			<button
				class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2 hover:bg-rose-300"
				onclick={() => (toggle = false)}>✕</button
			>
		</form>
		<form class="p-4" onsubmit={handleSubmit}>
			<label
				class="label text-base-content font-bold after:ml-0.5 after:text-red-500 after:content-['*']"
				for="nickname2">{m.nickname()}</label
			>
			<input
				class="input mb-1 block w-full"
				class:input-error={errors.nickname}
				type="text"
				placeholder={m.placeholder_nickname()}
				bind:value={nickname}
				maxlength="16"
				id="nickname2"
			/>
			{#if errors.nickname}
				<p class="text-error mb-3 text-sm">{m.error_field_required()}</p>
			{:else}
				<div class="mb-4"></div>
			{/if}
			<label class="label text-base-content font-bold" for="claim">{m.initial_claim()}</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder={m.placeholder_initial_claim()}
				id="claim"
				bind:value={initialClaim}
			/>
			<div class="mb-4 flex items-center gap-2">
				<input
					class="checkbox"
					type="checkbox"
					id="showNeutralCircle"
					bind:checked={showNeutralCircle}
				/>
				<label
					class="label text-base-content cursor-pointer"
					for="showNeutralCircle"
					title={m.show_neutral_circle_tooltip()}>{m.show_neutral_circle()}</label
				>
			</div>
			<div>
				<button class="btn btn-success float-left" type="submit">{m.start_spectrum()}</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>{m.cancel()}</button
				>
			</div>
		</form>
	</div>
</dialog>
