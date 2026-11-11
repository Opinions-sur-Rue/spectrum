<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { RoomState } from './room-client';
	import { RoomCountdown, timerDuration, timerLabel } from './room-timer';
	import { setTabTimer } from './tab-title';
	import { toolbarMenu } from './toolbar-menu';
	let {
		room,
		ready,
		send
	}: {
		room: RoomState;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let minutes = $state<number | undefined>(5);
	let seconds = $state<number | undefined>(0);
	let remaining = $state(0);
	let finished = $state(false);
	let menu = $state<HTMLDetailsElement>();
	const clock = new RoomCountdown();
	let observedRunning = false;
	const duration = $derived(timerDuration(minutes, seconds));
	const expired = $derived(!!room.timer?.endsAt && remaining === 0);
	function refresh() {
		remaining = clock.seconds(performance.now());
		if (observedRunning && remaining === 0) finished = true;
		setTabTimer(
			room.timer?.endsAt ? (remaining > 0 ? timerLabel(remaining) : m.timer_finished()) : null
		);
	}
	$effect(() => {
		const incoming = room.timer;
		if (!incoming) return;
		untrack(() => {
			const changed = incoming.revision !== clock.revision;
			if (!clock.update(incoming, performance.now())) return;
			if (changed) {
				finished = false;
				observedRunning = clock.seconds(performance.now()) > 0;
			}
			refresh();
		});
	});
	onMount(() => {
		const interval = setInterval(refresh, 200);
		return () => clearInterval(interval);
	});
	onDestroy(() => setTabTimer(null));
	function setTimer(value: number) {
		if (menu && ready && room.role === 'admin' && send('room.timer', { durationSeconds: value }))
			menu.open = false;
	}
</script>

<div class="room-timer flex items-center gap-1">
	{#if room.timer?.endsAt}
		<div
			class="timer-readout"
			class:expired
			class:finished
			data-testid="room-timer"
			data-finished={finished}
		>
			<span aria-hidden="true">⏱</span>
			<div class="timer-copy">
				<span role="timer" aria-label={m.timer_title()} aria-live="off"
					>{timerLabel(remaining)}</span
				>
				<span class="timer-completion" role="status">{expired ? m.timer_finished() : ''}</span>
			</div>
		</div>
	{/if}
	{#if room.role === 'admin'}
		<details bind:this={menu} class="relative z-40" use:toolbarMenu>
			<summary class="toolbar-summary" aria-label={m.timer_setup()} title={m.timer_setup()}>
				<span aria-hidden="true">⏱</span><span class="hidden sm:inline">{m.timer_title()}</span>
			</summary>
			<div class="toolbar-popover bg-base-100 w-64 rounded-xl border p-3 shadow-xl">
				<form
					class="space-y-3"
					onsubmit={(event) => {
						event.preventDefault();
						if (duration !== null) setTimer(duration);
					}}
				>
					<p class="text-sm">{m.timer_hint()}</p>
					<div class="flex gap-1" role="group" aria-label={m.timer_presets()}>
						{#each [1, 3, 5] as preset (preset)}
							<button
								class="btn btn-sm flex-1"
								class:btn-active={minutes === preset && seconds === 0}
								type="button"
								aria-pressed={minutes === preset && seconds === 0}
								disabled={!ready}
								onclick={() => {
									minutes = preset;
									seconds = 0;
								}}>{m.timer_preset({ minutes: preset })}</button
							>
						{/each}
					</div>
					<div class="flex gap-2">
						<label class="min-w-0 flex-1 text-sm"
							>{m.timer_minutes()}
							<input
								class="input input-sm input-bordered w-full"
								type="number"
								min="0"
								max="1440"
								step="1"
								required
								bind:value={minutes}
								disabled={!ready}
							/>
						</label>
						<label class="min-w-0 flex-1 text-sm"
							>{m.timer_seconds()}
							<input
								class="input input-sm input-bordered w-full"
								type="number"
								min="0"
								max="59"
								step="1"
								required
								bind:value={seconds}
								disabled={!ready}
							/>
						</label>
					</div>
					<button
						class="btn btn-sm btn-primary w-full"
						type="submit"
						disabled={!ready || duration === null}>{m.timer_start()}</button
					>
					{#if room.timer?.endsAt}<button
							class="btn btn-sm btn-ghost w-full"
							type="button"
							disabled={!ready}
							onclick={() => setTimer(0)}>{m.timer_cancel()}</button
						>{/if}
				</form>
			</div>
		</details>
	{/if}
</div>

<style>
	.timer-readout {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.65rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
	}
	.timer-copy {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
	}
	.timer-completion {
		font-size: 0.7rem;
	}
	.timer-completion:empty {
		display: none;
	}
	.expired {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}
	.finished {
		animation: timer-finish 1.2s ease-out;
	}
	@keyframes timer-finish {
		0%,
		60% {
			transform: scale(1);
		}
		30% {
			transform: scale(1.08);
			box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 15%, transparent);
		}
		100% {
			transform: scale(1);
			box-shadow: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.finished {
			animation: none;
		}
	}
</style>
