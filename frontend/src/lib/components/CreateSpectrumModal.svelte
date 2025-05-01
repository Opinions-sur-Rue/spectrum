<script lang="ts">
	/* eslint svelte/no-at-html-tags: "off" */
	import { palette } from '$lib/spectrum/palette';
	import { darkenHexColor } from '$lib/utils';

	interface ModalProps {
		toggle: boolean;
		onSubmit: (nickname: string, initialClaim: string, userId: string) => void;
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
			onsubmit={() =>
				nickname && initialClaim && userId && onSubmit(nickname, initialClaim, userId)}
		>
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
				<button class="btn btn-success float-left" type="submit">Créer un Spectrum</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>Annuler</button
				>
			</div>
		</form>
	</div>
</dialog>

<style>
	input[type='radio'] {
		/* Add if not using autoprefixer */
		-webkit-appearance: none;
		/* Remove most all native input styles */
		appearance: none;
		/* For iOS < 15 */

		margin: 0;

		font: inherit;

		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		transform: translateY(-0.075em);

		display: grid;

		place-content: center;
	}

	input[type='radio']::before {
		content: '';
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		transform: scale(0);
		transition: 20ms transform ease-in-out;
		box-shadow: inset 1rem 1rem rgb(244, 244, 244);
		/* Windows High Contrast Mode */
		/*background-color: CanvasText;*/
	}

	input[type='radio']:checked::before {
		transform: scale(1);
	}
</style>
