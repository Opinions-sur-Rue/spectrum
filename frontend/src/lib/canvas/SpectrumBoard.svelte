<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { RoomState, SpectrumState, Pellet } from './room-client';
	import { createCellDetector, cellLabel, type SpectrumCell } from './cells';
	import { createMovementStream } from './movement-stream';
	import { m } from '$lib/paraglide/messages.js';
	let {
		state: board,
		cells,
		labels,
		room,
		ready,
		scale,
		speakers = [],
		send
	}: {
		state: SpectrumState;
		cells: SpectrumCell[];
		labels: string;
		room: RoomState;
		ready: boolean;
		scale: number;
		speakers?: string[];
		send: (op: string, payload: unknown) => void;
	} = $props();
	let pending = $state<{ memberId: string; x: number; y: number } | null>(null);
	let dragging = $state(false);
	let pendingRevision = 0;
	let drag: {
		pointerId: number;
		memberId: string;
		x: number;
		y: number;
		clientX: number;
		clientY: number;
		scale: number;
		revision: number;
	} | null = null;
	const admin = $derived(room.role === 'admin');
	const detectCell = $derived(createCellDetector(cells));
	const ownPellet = $derived(board.pellets.find((pellet) => pellet.memberId === room.userId));
	const ownPoint = $derived(ownPellet ? coordinates(ownPellet) : null);
	const selectedCell = $derived(ownPoint ? detectCell(ownPoint.x, ownPoint.y) : null);
	const stream = createMovementStream((point) => {
		if (
			ready &&
			room.role !== 'spectator' &&
			board.pellets.some((pellet) => pellet.memberId === room.userId)
		)
			send('spectrum.move', point);
	});
	onDestroy(() => stream.cancel());

	$effect(() => {
		// Old echoes of intermediate drag points must never roll back the final point.
		const own = board.pellets.find((pellet) => pellet.memberId === room.userId);
		if (
			!ready ||
			room.role === 'spectator' ||
			!own ||
			(drag && board.revision !== drag.revision) ||
			(drag && drag.scale !== scale) ||
			(pending && board.revision !== pendingRevision)
		) {
			stream.cancel();
			pending = null;
			dragging = false;
			drag = null;
		} else if (!drag && pending && own.x === pending.x && own.y === pending.y) pending = null;
	});

	function coordinates(pellet: Pellet) {
		return pending?.memberId === pellet.memberId ? pending : pellet;
	}
	function clamp(x: number, y: number) {
		return { x: Math.max(14, Math.min(966, x)), y: Math.max(14, Math.min(721, y)) };
	}
	function start(event: PointerEvent, pellet: Pellet) {
		if (
			!ready ||
			room.role === 'spectator' ||
			pellet.memberId !== room.userId ||
			event.button !== 0 ||
			!event.isPrimary ||
			drag
		)
			return;
		event.preventDefault();
		const target = event.currentTarget as HTMLButtonElement;
		target.focus();
		target.setPointerCapture(event.pointerId);
		const point = coordinates(pellet);
		stream.cancel();
		pendingRevision = board.revision;
		drag = {
			pointerId: event.pointerId,
			memberId: pellet.memberId,
			x: point.x,
			y: point.y,
			clientX: event.clientX,
			clientY: event.clientY,
			scale,
			revision: board.revision
		};
		dragging = true;
	}
	function move(event: PointerEvent, done = false) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!ready || room.role === 'spectator') {
			cancel();
			return;
		}
		pending = {
			memberId: drag.memberId,
			...clamp(
				drag.x + (event.clientX - drag.clientX) / drag.scale,
				drag.y + (event.clientY - drag.clientY) / drag.scale
			)
		};
		if (done) {
			stream.finish({ x: pending.x, y: pending.y });
			drag = null;
			dragging = false;
		} else stream.update({ x: pending.x, y: pending.y });
	}
	function cancel() {
		if (!drag) return;
		if (pending && ready && room.role !== 'spectator' && board.revision === drag.revision)
			stream.finish({ x: pending.x, y: pending.y });
		else {
			stream.cancel();
			pending = null;
		}
		drag = null;
		dragging = false;
	}
	function keyMove(event: KeyboardEvent, pellet: Pellet) {
		if (!ready || room.role === 'spectator' || pellet.memberId !== room.userId) return;
		const directions: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const delta = directions[event.key];
		if (!delta) return;
		event.preventDefault();
		const point = coordinates(pellet);
		const distance = event.shiftKey ? 40 : 10;
		pendingRevision = board.revision;
		pending = {
			memberId: pellet.memberId,
			...clamp(point.x + delta[0] * distance, point.y + delta[1] * distance)
		};
		stream.finish({ x: pending.x, y: pending.y });
	}
</script>

<div
	class="spectrum-board"
	data-testid="spectrum-board"
	data-slice-count={board.sliceCount}
	data-neutral-circle={board.showNeutralCircle ?? true}
>
	{#if selectedCell}
		<svg
			class="cell-highlight"
			viewBox="0 0 980 735"
			aria-hidden="true"
			data-testid="spectrum-highlight"
			data-cell-id={selectedCell.id}><path d={selectedCell.path} /></svg
		>
	{/if}
	{#if labels}<img
			class="spectrum-labels"
			src={labels}
			alt=""
			aria-hidden="true"
			data-testid="spectrum-labels"
			draggable="false"
		/>{/if}
	{#each board.pellets as pellet (pellet.memberId)}
		{@const point = coordinates(pellet)}
		{@const own = pellet.memberId === room.userId && room.role !== 'spectator'}
		{@const cell = detectCell(point.x, point.y)}
		<button
			class="pellet"
			class:own
			class:speaking={speakers.includes(pellet.memberId)}
			data-speaking={speakers.includes(pellet.memberId)}
			class:dragging={dragging && own}
			disabled={!ready || !own}
			aria-label={own
				? m.v2_your_position()
				: m.v2_member_position({
						name: pellet.memberId === 'live_average' ? m.v2_live_average() : pellet.nickname
					})}
			title={`${pellet.memberId === 'live_average' ? m.v2_live_average() : pellet.nickname}${cell ? ` · ${cellLabel(cell.id)}` : ''}${own ? ` · ${m.v2_position_hint()}` : ''}`}
			class:live={pellet.memberId.startsWith('l_') || pellet.memberId === 'live_average'}
			style:left="{point.x - 14}px"
			style:top="{point.y - 14}px"
			style:background-color="#{pellet.color}"
			style:--hit-space="{Math.max(0, (44 / scale - 28) / 2)}px"
			style:--label-scale={1 / scale}
			style:--ring-space="{Math.max(8, 8 / scale)}px"
			style:--ring-width="{Math.max(3, 3 / scale)}px"
			data-pellet-id={pellet.memberId}
			data-own={own}
			data-x={point.x}
			data-y={point.y}
			data-cell-id={cell?.id ?? ''}
			onpointerdown={(event) => start(event, pellet)}
			onpointermove={(event) => move(event)}
			onpointerup={(event) => move(event, true)}
			onpointercancel={cancel}
			onlostpointercapture={cancel}
			onkeydown={(event) => keyMove(event, pellet)}
			>{#if own}<span class="own-label" aria-hidden="true">{m.ux_own_pellet()}</span><span
					class="own-mark"
					aria-hidden="true">●</span
				>{/if}</button
		>
	{/each}
	{#if admin && board.hidden}<span class="hidden-status">{m.v2_hidden_positions()}</span>{/if}
</div>

<style>
	.spectrum-board {
		position: absolute;
		left: -490px;
		top: -367.5px;
		width: 980px;
		height: 735px;
		pointer-events: none;
	}
	.pellet {
		z-index: 2;
		position: absolute;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 1px 5px #0006;
		pointer-events: auto;
		opacity: 1;
	}
	.pellet.speaking {
		z-index: 3;
	}
	.pellet.speaking::after {
		content: '';
		position: absolute;
		inset: calc(-1 * var(--ring-space));
		border: var(--ring-width) solid #22c55e;
		border-radius: 50%;
		box-shadow:
			0 0 0 2px #052e16,
			0 0 16px #22c55e99;
		pointer-events: none;
		animation: speaking-pulse 900ms ease-in-out infinite alternate;
	}
	@keyframes speaking-pulse {
		from {
			transform: scale(1);
			opacity: 1;
		}
		to {
			transform: scale(1.18);
			opacity: 0.65;
		}
	}
	.own-label {
		position: absolute;
		left: 50%;
		bottom: calc(100% + var(--ring-space) + 8px);
		transform: translateX(-50%) scale(var(--label-scale));
		transform-origin: bottom center;
		border: 1px solid var(--color-base-content);
		border-radius: 999px;
		padding: 3px 9px;
		background: var(--color-base-100);
		color: var(--color-base-content);
		font-size: 12px;
		font-weight: 700;
		line-height: 1.3;
		white-space: nowrap;
		pointer-events: none;
	}
	.own-mark {
		color: white;
		font-size: 13px;
		line-height: 24px;
		text-shadow: 0 1px 3px black;
		pointer-events: none;
	}
	.pellet.live {
		border: 3px dashed white;
	}
	.cell-highlight {
		z-index: 0;
		position: absolute;
		inset: 0;
		width: 980px;
		height: 735px;
		pointer-events: none;
	}
	.spectrum-labels {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 980px;
		height: 735px;
		pointer-events: none;
	}
	.cell-highlight path {
		fill: #10b1b18c;
		stroke: #10b1b1;
		stroke-width: 3;
	}
	.pellet:not(.own) {
		transition:
			left 50ms linear,
			top 50ms linear;
	}
	@media (prefers-reduced-motion: reduce) {
		.pellet:not(.own) {
			transition: none;
		}
		.pellet.speaking::after {
			animation: none;
		}
	}
	.pellet.own {
		z-index: 4;
		cursor: grab;
		touch-action: none;
		outline: 2px solid #334155;
		outline-offset: 2px;
	}
	.pellet.own::before {
		content: '';
		position: absolute;
		inset: calc(-1 * var(--hit-space));
		border-radius: 50%;
	}
	.pellet.own:focus-visible {
		outline: 3px solid #2563eb;
		outline-offset: 3px;
	}
	.pellet.dragging {
		cursor: grabbing;
	}
	.hidden-status {
		position: absolute;
		bottom: -24px;
		left: 0;
		width: 100%;
		text-align: center;
		font-size: 13px;
		opacity: 0.65;
	}
</style>
