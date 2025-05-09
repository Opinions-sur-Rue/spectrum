<script lang="ts">
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
				el.show();
			} else {
				el.close();
			}
		}
	});

	let nickname: string | undefined = $state();
</script>

<dialog id={modalId} class="modal">
	<div class="modal-box">
		<form method="dialog">
			<button
				class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2 hover:bg-rose-300"
				onclick={() => (toggle = false)}>✕</button
			>
		</form>
		<form class="p-4" onsubmit={() => spectrumId && nickname && onSubmit(spectrumId, nickname)}>
			<label class="label font-bold text-gray-900" for="spectrumId">Identifiant du Spectrum</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer l'identifiant du spectrum que vous voulez rejoindre"
				id="spectrumId"
				bind:value={spectrumId}
				required
			/>
			<label class="label font-bold text-gray-900" for="nickname1">Pseudo</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer un pseudo (n'utilisez pas votre nom réel)"
				bind:value={nickname}
				id="nickname1"
				required
			/>
			<div>
				<button class="btn btn-success float-left" type="submit">Rejoindre le Spectrum</button>
				<button class="btn btn-warning float-right" onclick={() => (toggle = false)} type="button"
					>Annuler</button
				>
			</div>
		</form>
	</div>
</dialog>
