<script lang="ts">
	import { onDestroy } from 'svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { RoomState, SpectrumState, Pellet } from './room-client';
	import { createCellDetector, cellLabel, type SpectrumCell } from './cells';
	import { createMovementStream } from './movement-stream';
	let {
		state: board,
		cells,
		room,
		ready,
		scale,
		send
	}: {
		state: SpectrumState;
		cells: SpectrumCell[];
		room: RoomState;
		ready: boolean;
		scale: number;
		send: (op: string, payload: unknown) => void;
	} = $props();
	let topic = $state('');
	let topicDirty = $state(false);
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
		if (!topicDirty || board.topic === topic) {
			topic = board.topic;
			topicDirty = false;
		}
	});
	$effect(() => {
		// Old echoes of intermediate drag points must never roll back the final point.
		const own = board.pellets.find((pellet) => pellet.memberId === room.userId);
		if (
			!ready ||
			room.role === 'spectator' ||
			!own ||
			(drag && board.revision !== drag.revision) ||
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

<div class="spectrum-board" data-testid="spectrum-board">
	{#if selectedCell}
		<svg
			class="cell-highlight"
			viewBox="0 0 980 735"
			aria-hidden="true"
			data-testid="spectrum-highlight"
			data-cell-id={selectedCell.id}><path d={selectedCell.path} /></svg
		>
	{/if}
	<div class="topic">
		{#if admin}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					send('spectrum.topic', { topic });
				}}
			>
				<input
					aria-label="Discussion topic"
					placeholder="What are we discussing?"
					maxlength="500"
					disabled={!ready}
					bind:value={topic}
					oninput={() => {
						topicDirty = true;
					}}
				/>
				{#if topicDirty}<IconButton
						icon="save"
						label="Save topic"
						disabled={!ready}
						type="submit"
					/>{/if}
			</form>
		{:else}<h1>{board.topic || 'Spectrum'}</h1>{/if}
	</div>
	{#each board.pellets as pellet (pellet.memberId)}
		{@const point = coordinates(pellet)}
		{@const own = pellet.memberId === room.userId && room.role !== 'spectator'}
		{@const cell = detectCell(point.x, point.y)}
		<button
			class="pellet"
			class:own
			class:dragging={dragging && own}
			disabled={!ready || !own}
			aria-label={own ? 'Your position' : `${pellet.nickname}'s position`}
			title={`${pellet.nickname}${cell ? ` · ${cellLabel(cell.id)}` : ''}${own ? ' · drag or use arrow keys' : ''}`}
			style:left="{point.x - 14}px"
			style:top="{point.y - 14}px"
			style:background-color="#{pellet.color}"
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
		></button>
	{/each}
	{#if admin && board.hidden}<span class="hidden-status">Positions hidden from others</span>{/if}
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
	.topic {
		position: absolute;
		top: -58px;
		left: 0;
		width: 100%;
		min-height: 38px;
		text-align: center;
	}
	.topic h1 {
		font-size: 22px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.topic form {
		display: flex;
		justify-content: center;
		gap: 8px;
		align-items: center;
		pointer-events: auto;
	}
	.topic input {
		flex: 1;
		min-width: 0;
		background: transparent;
		font-size: 22px;
		font-weight: 600;
		text-align: center;
		border: 0;
		border-bottom: 1px solid transparent;
		outline: none;
	}
	.topic input:hover,
	.topic input:focus {
		border-color: #94a3b8;
	}
	.pellet {
		position: absolute;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 1px 5px #0006;
		pointer-events: auto;
		opacity: 1;
	}
	.cell-highlight {
		position: absolute;
		inset: 0;
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
	}
	.pellet.own {
		cursor: grab;
		touch-action: none;
		outline: 2px solid #334155;
		outline-offset: 2px;
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
