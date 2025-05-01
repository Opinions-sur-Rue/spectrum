<script lang="ts">
	/* eslint svelte/no-at-html-tags: "off" */
	import { palette } from '$lib/spectrum/palette';
	import { darkenHexColor } from '$lib/utils';

	interface ModalProps {
		toggle: boolean;
		spectrumId: string | undefined;
		onSubmit: (nickname: string, initialClaim: string, userId: string) => void;
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
	let userId: string | undefined = $state();
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
			onsubmit={() => spectrumId && nickname && userId && onSubmit(spectrumId, nickname, userId)}
		>
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
			<p><b>Choisissez une couleur</b></p>
			<div class="grid grid-cols-3 grid-rows-4 gap-0 p-4">
				{#each Object.entries(palette) as [colorHex, colorName] (colorHex)}
					<div class="m-2">
						<label class="label font-mono">
							<input
								class="radio"
								type="radio"
								name="color"
								value={colorHex}
								bind:group={userId}
								style="background-color: #{colorHex} !important; color: #{darkenHexColor(
									colorHex,
									50
								)} !important; border: 1px solid #{darkenHexColor(colorHex, 20)} !important;"
							/>
							{@html colorName.replace(/ /g, '&nbsp;')}
						</label>
					</div>
				{/each}
			</div>

			<div>
				<button class="btn btn-success float-left" type="submit">Rejoindre le Spectrum</button>
				<button class="btn btn-warning float-right" onclick={() => (toggle = false)} type="button"
					>Annuler</button
				>
			</div>
		</form>
	</div>
</dialog>
