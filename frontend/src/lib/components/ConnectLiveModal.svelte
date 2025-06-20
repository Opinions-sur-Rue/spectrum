<script lang="ts">
	interface ModalProps {
		toggle: boolean;
		onSubmit: (channel: 'youtube' | 'tiktok', liveId: string, secret: string) => void;
	}

	let { toggle = $bindable(false), onSubmit }: ModalProps = $props();

	const modalId = 'connect-live';

	$effect(() => {
		const el = document.getElementById(modalId);
		if (el instanceof HTMLDialogElement) {
			if (toggle) {
				console.log('COUCOU');
				el.show();
			} else {
				el.close();
			}
		}
	});

	let channel: 'youtube' | 'tiktok' | undefined = $state();
	let liveId: string | undefined = $state();
	let secret: string | undefined = $state();
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
			onsubmit={() => channel && liveId && secret && onSubmit(channel, liveId, secret)}
		>
			<label class="label block font-bold text-gray-900" for="nickname2">Plate-forme</label>
			<select class="select mb-6 block" bind:value={channel}>
				<option disabled selected>Choisissez une Plate-forme</option>
				<option value="youtube">YouTube</option>
				<option value="tiktok">TikTok</option>
			</select>
			<label class="label font-bold text-gray-900" for="claim">ID du live</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer l'ID du live auquel vous voulez vous connecter"
				id="claim"
				bind:value={liveId}
				required
			/>
			<label class="label font-bold text-gray-900" for="claim">Secret</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder="Veuillez entrer le secret pour se connecter au service de la plate-forme"
				id="claim"
				bind:value={secret}
				required
			/>
			<div>
				<button class="btn btn-success float-left" type="submit">Démarrer la connection</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>Annuler</button
				>
			</div>
		</form>
	</div>
</dialog>
