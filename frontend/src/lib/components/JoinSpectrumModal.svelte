<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface ModalProps {
		toggle: boolean;
		spectrumId: string | undefined;
		onSubmit: (nickname: string, initialClaim: string) => void;
	}

	let { toggle = $bindable(false), spectrumId = $bindable(), onSubmit }: ModalProps = $props();

	const modalId = 'join-modal';

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
	let errors = $state({ spectrumId: false, nickname: false });

	function handleSubmit() {
		errors.spectrumId = !spectrumId?.trim();
		errors.nickname = !nickname?.trim();
		if (!errors.spectrumId && !errors.nickname) {
			onSubmit(spectrumId!, nickname!);
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
				for="spectrumId">{m.spectrum_id()}</label
			>
			<input
				class="input mb-1 block w-full"
				class:input-error={errors.spectrumId}
				type="text"
				placeholder={m.placeholder_spectrum_id()}
				id="spectrumId"
				bind:value={spectrumId}
			/>
			{#if errors.spectrumId}
				<p class="text-error mb-3 text-sm">{m.error_field_required()}</p>
			{:else}
				<div class="mb-4"></div>
			{/if}
			<label
				class="label text-base-content font-bold after:ml-0.5 after:text-red-500 after:content-['*']"
				for="nickname1">{m.nickname()}</label
			>
			<input
				class="input mb-1 block w-full"
				class:input-error={errors.nickname}
				type="text"
				placeholder={m.placeholder_nickname()}
				maxlength="16"
				bind:value={nickname}
				id="nickname1"
			/>
			{#if errors.nickname}
				<p class="text-error mb-3 text-sm">{m.error_field_required()}</p>
			{:else}
				<div class="mb-4"></div>
			{/if}
			<div>
				<button class="btn btn-neutral float-left" type="submit">{m.join()}</button>
				<button class="btn btn-warning float-right" onclick={() => (toggle = false)} type="button"
					>{m.cancel()}</button
				>
			</div>
		</form>
	</div>
</dialog>
