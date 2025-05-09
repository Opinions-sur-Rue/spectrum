<script lang="ts">
	interface ModalProps {
		toggle: boolean;
		onSubmit: (nickname: string, initialClaim: string) => void;
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
		<form class="p-4" onsubmit={() => nickname && initialClaim && onSubmit(nickname, initialClaim)}>
			<label class="label font-bold text-gray-900" for="nickname2">Pseudo</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer un pseudo (n'utilisez pas votre nom réel)"
				bind:value={nickname}
				id="nickname2"
				required
			/>
			<label class="label font-bold text-gray-900" for="claim">Claim initial</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer le claim"
				id="claim"
				bind:value={initialClaim}
				required
			/>
			<div>
				<button class="btn btn-success float-left" type="submit">Créer un Spectrum</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>Annuler</button
				>
			</div>
		</form>
	</div>
</dialog>
