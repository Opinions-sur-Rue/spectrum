<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	let {
		connected,
		roomInput = $bindable(''),
		slices = $bindable(7),
		neutralCircle = $bindable(true),
		topic = $bindable(''),
		send,
		error = ''
	}: {
		connected: boolean;
		roomInput?: string;
		slices?: number;
		neutralCircle?: boolean;
		topic?: string;
		send: (op: string, payload: unknown) => boolean;
		error?: string;
	} = $props();
	function join() {
		let roomId = roomInput.trim();
		try {
			const link = new URL(roomId);
			if (link.protocol === 'http:' || link.protocol === 'https:')
				roomId = link.searchParams.get('room') ?? roomId;
		} catch {
			/* Plain room code. */
		}
		send('room.join', { roomId });
	}
</script>

<div class="lobby">
	<section class="lobby-card" aria-label={m.ux_welcome_title()}>
		<header>
			<p class="eyebrow">Spectrum</p>
			<h1>{m.ux_welcome_title()}</h1>
			<p class="intro">{m.ux_welcome_hint()}</p>
			{#if error}<p role="alert" class="mt-3 rounded-lg border p-3 text-sm">{error}</p>{/if}
		</header>
		<div class="lobby-forms">
			<form
				onsubmit={(event) => {
					event.preventDefault();
					send('room.create', { sliceCount: slices, showNeutralCircle: neutralCircle, topic });
				}}
			>
				<h2>{m.ux_create_title()}</h2>
				<label class="field-label" for="initial-topic">{m.initial_claim()}</label>
				<input
					id="initial-topic"
					class="input w-full"
					data-testid="initial-topic"
					disabled={!connected}
					placeholder={m.ux_initial_topic_hint()}
					maxlength="500"
					bind:value={topic}
				/>
				<div class="setup-row">
					<label for="create-slices">{m.spectrum_slices()}</label><select
						id="create-slices"
						class="select select-sm w-24"
						data-testid="spectrum-slice-count"
						disabled={!connected}
						bind:value={slices}
						>{#each [3, 5, 7, 9] as count (count)}<option value={count}>{count}</option
							>{/each}</select
					>
				</div>
				<label class="circle-label" title={m.show_neutral_circle_tooltip()}
					><input
						class="checkbox checkbox-sm"
						type="checkbox"
						data-testid="spectrum-neutral-circle"
						disabled={!connected}
						bind:checked={neutralCircle}
					/>{m.show_neutral_circle()}</label
				>
				<button
					type="submit"
					data-testid="create-room"
					class="btn btn-primary mt-3 w-full"
					disabled={!connected}><Icon name="plus" />{m.ux_create_room()}</button
				>
			</form>
			<form
				class="join-form"
				onsubmit={(event) => {
					event.preventDefault();
					join();
				}}
			>
				<h2>{m.ux_join_title()}</h2>
				<p class="join-hint">{m.ux_join_hint()}</p>
				<label class="field-label" for="join-room">{m.ux_room_code()}</label>
				<input
					id="join-room"
					class="input w-full"
					aria-label={m.v2_room_id()}
					placeholder="OSR-…"
					autocomplete="off"
					spellcheck="false"
					disabled={!connected}
					bind:value={roomInput}
				/>
				<button
					type="submit"
					data-testid="join-room"
					class="btn btn-outline mt-3 w-full"
					disabled={!connected || !roomInput.trim()}>{m.ux_join_room()}</button
				>
			</form>
		</div>
		<p class="privacy">{m.ux_privacy_hint()}</p>
	</section>
</div>

<style>
	.lobby {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: grid;
		place-items: center;
		padding: 24px;
		pointer-events: none;
	}
	.lobby-card {
		width: min(820px, 100%);
		max-height: 100%;
		overflow-y: auto;
		pointer-events: auto;
		border: 1px solid var(--color-base-300);
		border-radius: 20px;
		background: var(--color-base-100);
		box-shadow: 0 20px 80px #0002;
	}
	header {
		padding: 28px 28px 20px;
	}
	.eyebrow {
		color: var(--color-primary);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 10px;
	}
	h1 {
		margin-top: 8px;
		font-size: clamp(22px, 3vw, 30px);
		font-weight: 650;
		line-height: 1.25;
	}
	.intro {
		margin-top: 10px;
		font-size: 13px;
		opacity: 0.65;
		max-width: 65ch;
	}
	.lobby-forms {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0 28px;
		gap: 28px;
	}
	h2 {
		font-size: 14px;
		font-weight: 650;
		margin-bottom: 16px;
	}
	.field-label {
		display: block;
		font-size: 12px;
		margin-bottom: 6px;
	}
	.setup-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 14px;
		font-size: 12px;
	}
	.circle-label {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		margin-top: 14px;
	}
	.join-form {
		padding-left: 28px;
		border-left: 1px solid var(--color-base-300);
	}
	.join-hint {
		margin-bottom: 20px;
		font-size: 13px;
		opacity: 0.65;
		line-height: 1.6;
	}
	.privacy {
		margin-top: 24px;
		padding: 16px 28px;
		border-top: 1px solid var(--color-base-300);
		font-size: 11px;
		opacity: 0.75;
	}
	@media (max-width: 639px) {
		.lobby {
			padding: 12px;
		}
		header {
			padding: 22px 20px 16px;
		}
		.lobby-forms {
			grid-template-columns: 1fr;
			padding: 0 20px;
			gap: 20px;
		}
		.join-form {
			padding: 20px 0 0;
			border-left: 0;
			border-top: 1px solid var(--color-base-300);
		}
		.join-hint {
			margin-bottom: 12px;
		}
		.privacy {
			padding: 14px 20px;
		}
	}
</style>
