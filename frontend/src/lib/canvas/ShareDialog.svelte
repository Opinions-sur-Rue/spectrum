<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { dialogFocus } from './dialog-focus';
	let { open = $bindable(false), roomId }: { open?: boolean; roomId: string } = $props();
	let dialog = $state<HTMLDialogElement>();
	let url = $state('');
	let qr = $state('');
	let failure = $state(false);
	let notice = $state('');
	$effect(() => {
		if (!open) return;
		const link = new URL('/v2', location.origin);
		link.searchParams.set('room', roomId);
		url = link.href;
		qr = '';
		failure = false;
		notice = '';
		let cancelled = false;
		void import('qrcode')
			.then((module) =>
				module.toDataURL(link.href, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
			)
			.then((image) => {
				if (!cancelled) qr = image;
			})
			.catch(() => {
				if (!cancelled) failure = true;
			});
		return () => {
			cancelled = true;
		};
	});
	$effect(() => {
		if (open && dialog && !dialog.open) dialog.showModal();
	});
</script>

{#if open}<dialog
		use:dialogFocus
		bind:this={dialog}
		class="bg-base-100 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40"
		aria-labelledby="share-title"
		oncancel={() => {
			open = false;
		}}
	>
		<h2 id="share-title" class="mb-3 text-lg font-semibold">{m.v2_share_title()}</h2>
		<p class="text-sm opacity-70">{m.v2_share_hint()}</p>
		<div class="my-4 flex min-h-64 justify-center">
			{#if qr}<img
					src={qr}
					width="256"
					height="256"
					alt={m.v2_share_qr()}
					data-testid="share-qr"
				/>{:else if failure}<p role="alert">{m.v2_share_error()}</p>{:else}<span
					class="loading loading-spinner"
					aria-label={m.ux_online()}
				></span>{/if}
		</div>
		<input
			type="url"
			class="input w-full"
			readonly
			value={url}
			aria-label={m.v2_share_link()}
			data-testid="share-link"
			onclick={(event) => event.currentTarget.select()}
		/>
		<p role="status" class="mt-2 text-xs">{notice}</p>
		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="btn btn-ghost"
				onclick={() => {
					open = false;
				}}>{m.close()}</button
			><button
				type="button"
				class="btn btn-primary"
				onclick={async () => {
					try {
						await navigator.clipboard.writeText(url);
						notice = m.ux_link_copied();
					} catch {
						notice = m.ux_copy_link_hint();
					}
				}}>{m.v2_share_copy()}</button
			>
		</div>
	</dialog>{/if}
