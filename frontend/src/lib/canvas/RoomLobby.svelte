<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import { parseRoomCode } from './room-code';
	let {
		connected,
		roomInput = $bindable(''),
		slices = $bindable(7),
		neutralCircle = $bindable(true),
		topic = $bindable(''),
		send,
		error = '',
		missingRoom = false,
		recentRoom = '',
		forgetRecent = () => {}
	}: {
		connected: boolean;
		roomInput?: string;
		slices?: number;
		neutralCircle?: boolean;
		topic?: string;
		send: (op: string, payload: unknown) => boolean;
		error?: string;
		missingRoom?: boolean;
		recentRoom?: string;
		forgetRecent?: () => void;
	} = $props();
	let invalidCode = $state(false);
	let joinInput = $state<HTMLInputElement>();
	let createSection = $state<HTMLFormElement>();
	function focusCreate() {
		createSection?.scrollIntoView({
			block: 'center',
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
		document.getElementById('initial-topic')?.focus();
	}
	function join() {
		if (!connected) return;
		const roomId = parseRoomCode(roomInput);
		invalidCode = roomId === null;
		if (!roomId) {
			joinInput?.focus();
			return;
		}
		roomInput = roomId;
		send('room.join', { roomId });
	}
	function joinRecent() {
		roomInput = recentRoom;
		join();
	}
</script>

<div class="lobby">
	<section class="lobby-card" aria-label={m.ux_welcome_title()}>
		<header>
			<p class="eyebrow">Spectrum</p>
			<h1>{m.ux_welcome_title()}</h1>
			<p class="intro">{m.ux_welcome_hint()}</p>
			{#if error}<div role="alert" class="mt-3 rounded-lg border p-3 text-sm">
					{error}
					{#if missingRoom}<button
							type="button"
							class="btn btn-xs mt-2"
							data-testid="create-instead"
							onclick={focusCreate}>{m.ux_create_instead()}</button
						>{/if}
				</div>{/if}
		</header>
		<div class="lobby-forms">
			<form
				bind:this={createSection}
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
					bind:this={joinInput}
					id="join-room"
					class="input w-full"
					aria-label={m.v2_room_id()}
					placeholder="OSR-…"
					autocomplete="off"
					spellcheck="false"
					autocapitalize="characters"
					enterkeyhint="go"
					aria-invalid={invalidCode}
					aria-describedby={invalidCode ? 'join-room-error' : 'join-room-help'}
					oninput={() => {
						invalidCode = false;
					}}
					disabled={!connected}
					bind:value={roomInput}
				/>
				{#if invalidCode}
					<p id="join-room-error" role="alert" class="text-error mt-2 text-sm">
						{m.ux_room_code_invalid()}
					</p>
				{:else}
					<p id="join-room-help" class="mt-2 text-xs opacity-70">{m.ux_room_code_help()}</p>
				{/if}
				<button
					type="submit"
					data-testid="join-room"
					class="btn btn-outline mt-3 w-full"
					disabled={!connected || !roomInput.trim()}>{m.ux_join_room()}</button
				>
				{#if recentRoom && recentRoom !== roomInput}
					<div class="recent-room">
						<button
							type="button"
							class="btn btn-sm btn-ghost min-w-0 flex-1"
							data-testid="recent-room"
							disabled={!connected}
							onclick={joinRecent}
							><span class="truncate">{m.ux_recent_room({ code: recentRoom })}</span></button
						><button
							type="button"
							class="btn btn-sm btn-ghost"
							data-testid="forget-recent"
							aria-label={m.ux_forget_recent()}
							title={m.ux_forget_recent()}
							onclick={forgetRecent}>×</button
						>
					</div>
				{/if}
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
	.recent-room {
		display: flex;
		gap: 4px;
		margin-top: 8px;
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
