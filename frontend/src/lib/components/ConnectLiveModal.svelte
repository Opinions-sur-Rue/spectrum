<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface ModalProps {
		toggle: boolean;
		onSubmit: (channel: 'youtube' | 'tiktok' | 'twitch', liveId: string, secret: string) => void;
	}

	let { toggle = $bindable(false), onSubmit }: ModalProps = $props();

	const modalId = 'connect-live';

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

	let channel: 'youtube' | 'tiktok' | 'twitch' | undefined = $state();
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
				<option disabled selected>{m.pick_platform()}</option>
				<option value="youtube">YouTube</option>
				<option value="tiktok">TikTok</option>
				<option value="twitch">Twitch</option>
			</select>
			<label class="label font-bold text-gray-900" for="claim">{m.live_id()}</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder={m.placeholder_live_id()}
				id="claim"
				bind:value={liveId}
				required
			/>
			<label class="label font-bold text-gray-900" for="claim">{m.secret()}</label>
			<input
				class="input mb-4 block w-full"
				type="text"
				placeholder={m.placeholder_secret()}
				id="claim"
				bind:value={secret}
				required
			/>
			<div>
				<button class="btn btn-success float-left" type="submit">{m.start_connection()}</button>
				<button class="btn btn-warning float-right" type="button" onclick={() => (toggle = false)}
					>{m.cancel()}</button
				>
			</div>
		</form>
	</div>
</dialog>
