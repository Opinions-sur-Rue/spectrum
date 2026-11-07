<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { EdgeModel, NoteModel, Relation } from './models';
	import { m } from '$lib/paraglide/messages.js';
	import { relationLabel } from './labels';
	import type { NoteDrafts } from './note-drafts';
	import { noteInspector } from './note-inspector';
	import { noteDock } from './note-dock';
	import { MIN_NOTE_WIDTH, MIN_NOTE_HEIGHT, MAX_NOTE_WIDTH, MAX_NOTE_HEIGHT } from './note-layout';

	let {
		note,
		drafts,
		hidden = false,
		presentation = false,
		editable,
		admin,
		ready,
		audienceEnabled,
		notes,
		edges,
		scale,
		send,
		move,
		resize
	}: {
		note: NoteModel;
		drafts: NoteDrafts;
		hidden?: boolean;
		presentation?: boolean;
		editable: boolean;
		admin: boolean;
		ready: boolean;
		audienceEnabled: boolean;
		notes: NoteModel[];
		edges: EdgeModel[];
		scale: number;
		send: (op: string, payload: unknown) => void;
		move: (id: string, x: number, y: number, done: boolean) => void;
		resize: (id: string, width: number, height: number, done: boolean) => void;
	} = $props();
	let element: HTMLDivElement;
	let editor = $state<Editor | null>(null);
	let dirty = $state(false);
	let conflict = $state(false);
	let draft = '';
	let baseVersion: number | undefined;
	let confirmedMarkdown = '';
	let targetId = $state('');
	let relation = $state<Relation>('supports');
	let dragging = $state(false);
	let resizing = $state(false);
	let compact = $state(false);
	let inspecting = $state(false);
	$effect(() => {
		if (presentation) inspecting = false;
	});
	const nudges = [
		{ label: () => m.ux_note_left(), symbol: '←', dx: -40, dy: 0 },
		{ label: () => m.ux_note_up(), symbol: '↑', dx: 0, dy: -40 },
		{ label: () => m.ux_note_down(), symbol: '↓', dx: 0, dy: 40 },
		{ label: () => m.ux_note_right(), symbol: '→', dx: 40, dy: 0 }
	];
	let sizeDrag: {
		pointerId: number;
		width: number;
		height: number;
		x: number;
		y: number;
		scale: number;
	} | null = null;
	let suppressClick = false;
	let drag: {
		pointerId: number;
		x: number;
		y: number;
		clientX: number;
		clientY: number;
		scale: number;
	} | null = null;
	const visibility = $derived(
		note.moderation !== 'approved'
			? note.moderation === 'pending'
				? m.v2_note_pending()
				: m.v2_note_rejected()
			: !note.visible
				? m.v2_note_hidden()
				: audienceEnabled
					? m.v2_note_visible()
					: m.v2_note_revealed()
	);

	onMount(() => {
		const media = window.matchMedia('(max-width: 1023px)');
		function updateCompact() {
			compact = media.matches;
			if (!compact) inspecting = false;
		}
		updateCompact();
		media.addEventListener('change', updateCompact);
		const saved = editable || presentation ? drafts.get(note.id) : undefined;
		confirmedMarkdown = saved?.baseMarkdown ?? note.markdown;
		draft = saved?.markdown ?? note.markdown;
		baseVersion = saved ? saved.baseVersion : note.version;
		dirty = draft !== note.markdown;
		conflict =
			!!saved &&
			dirty &&
			(note.version !== saved.baseVersion || note.markdown !== saved.baseMarkdown);
		const instance = new Editor({
			element,
			extensions: [
				StarterKit.configure({ link: { openOnClick: false }, heading: { levels: [1, 2, 3] } }),
				Markdown
			],
			content: draft,
			contentType: 'markdown',
			editable: editable && ready,
			editorProps: {
				attributes: { role: 'textbox', 'aria-label': m.v2_note_content(), 'aria-multiline': 'true' }
			},
			onUpdate: ({ editor: current }) => {
				draft = current.getMarkdown();
				dirty = draft !== confirmedMarkdown;
				drafts.set(note.id, { markdown: draft, baseMarkdown: confirmedMarkdown, baseVersion });
			}
		});
		editor = instance;
		const events = new AbortController();
		element.addEventListener('pointerdown', startDrag, { capture: true, signal: events.signal });
		element.addEventListener('pointermove', dragMove, { signal: events.signal });
		element.addEventListener('pointerup', finishDrag, { signal: events.signal });
		element.addEventListener('pointercancel', cancelDrag, { signal: events.signal });
		element.addEventListener('lostpointercapture', cancelDrag, { signal: events.signal });
		element.addEventListener('click', swallowDragClick, { capture: true, signal: events.signal });
		return () => {
			media.removeEventListener('change', updateCompact);
			events.abort();
			drag = null;
			editor = null;
			instance.destroy();
		};
	});

	$effect(() => {
		editor?.setEditable(editable && ready, false);
		if (editor && !editable && !presentation) {
			// Approval or role revocation must not expose a retained private draft.
			if (dirty) reload();
			drafts.delete(note.id);
		}
	});
	$effect(() => {
		if (!editor) return;
		const incoming = note.markdown;
		if (!dirty || incoming === draft) {
			if (incoming !== confirmedMarkdown)
				editor.commands.setContent(incoming, { contentType: 'markdown', emitUpdate: false });
			confirmedMarkdown = incoming;
			draft = incoming;
			baseVersion = note.version;
			dirty = false;
			conflict = false;
			drafts.delete(note.id);
		} else if (incoming === confirmedMarkdown) {
			// Geometry-only updates do not conflict with an unsaved text edit.
			baseVersion = note.version;
			conflict = false;
			drafts.set(note.id, { markdown: draft, baseMarkdown: confirmedMarkdown, baseVersion });
		} else {
			conflict = true;
		}
	});

	function reload() {
		if (!editor) return;
		if (editable && ready) editor.view.focus();
		editor.commands.setContent(note.markdown, { contentType: 'markdown', emitUpdate: false });
		confirmedMarkdown = note.markdown;
		draft = note.markdown;
		baseVersion = note.version;
		dirty = false;
		conflict = false;
		drafts.delete(note.id);
	}
	function save() {
		if (!editor || !editable || !ready || !dirty || conflict) return;
		// Saving disables/removes dock controls after acknowledgment. Keep focus in
		// the editor so the dock does not collapse or move away from the pointer.
		editor.view.focus();
		send('note.update', { noteId: note.id, version: baseVersion, markdown: draft });
	}

	function moderate(decision: 'approved' | 'rejected') {
		// Keep focus inside the card when the clicked moderation button disappears.
		element.querySelector<HTMLElement>('.tiptap')?.focus();
		send('note.moderate', { noteId: note.id, decision });
	}

	function startDrag(event: PointerEvent) {
		if (compact || inspecting) return;
		if (drag) return;
		suppressClick = false;
		if (!editable || !ready || note.pinned || event.button !== 0 || !event.isPrimary) return;
		// Once editing, keep native caret placement and text-selection gestures.
		if (element.contains(document.activeElement)) return;
		event.preventDefault();
		event.stopPropagation();
		element.setPointerCapture(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			x: note.x,
			y: note.y,
			clientX: event.clientX,
			clientY: event.clientY,
			scale
		};
	}
	function dragMove(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!editable || !ready || note.pinned) {
			cancelDrag();
			return;
		}
		// Threshold is in screen pixels, independent of canvas zoom.
		if (!dragging && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5)
			return;
		dragging = true;
		suppressClick = true;
		const x = drag.x + (event.clientX - drag.clientX) / drag.scale;
		const y = drag.y + (event.clientY - drag.clientY) / drag.scale;
		move(note.id, x, y, false);
	}
	function finishDrag(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!editable || !ready || note.pinned) {
			cancelDrag();
			if (element.hasPointerCapture(event.pointerId))
				element.releasePointerCapture(event.pointerId);
			return;
		}
		const start = drag;
		if (dragging || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 5) {
			suppressClick = true;
			move(
				note.id,
				start.x + (event.clientX - start.clientX) / start.scale,
				start.y + (event.clientY - start.clientY) / start.scale,
				true
			);
		} else if (editor && editable && ready) {
			const position = editor.view.posAtCoords({ left: start.clientX, top: start.clientY });
			if (position) editor.commands.setTextSelection(position.pos);
			editor.view.focus();
		}
		drag = null;
		dragging = false;
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
	}
	function cancelDrag() {
		if (drag && dragging) move(note.id, drag.x, drag.y, true);
		if (drag) suppressClick = true;
		drag = null;
		dragging = false;
	}
	function swallowDragClick(event: MouseEvent) {
		if (!suppressClick || event.detail === 0) return;
		event.preventDefault();
		event.stopPropagation();
	}
	function startResize(event: PointerEvent) {
		if (!editable || !ready || note.pinned || event.button !== 0 || !event.isPrimary || sizeDrag)
			return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		sizeDrag = {
			pointerId: event.pointerId,
			width: note.width,
			height: note.height,
			x: event.clientX,
			y: event.clientY,
			scale
		};
		resizing = true;
	}
	function moveResize(event: PointerEvent, done = false) {
		if (!sizeDrag || sizeDrag.pointerId !== event.pointerId) return;
		if (!editable || !ready || note.pinned) {
			cancelResize();
			return;
		}
		resize(
			note.id,
			sizeDrag.width + (event.clientX - sizeDrag.x) / sizeDrag.scale,
			sizeDrag.height + (event.clientY - sizeDrag.y) / sizeDrag.scale,
			done
		);
		if (done) {
			sizeDrag = null;
			resizing = false;
		}
	}
	function cancelResize() {
		if (sizeDrag) {
			resize(note.id, sizeDrag.width, sizeDrag.height, false);
			// A concurrent remote resize may have arrived during this gesture.
			if (ready) send('canvas.get', {});
		}
		sizeDrag = null;
		resizing = false;
	}
	function keyResize(event: KeyboardEvent) {
		if (!editable || !ready || note.pinned) return;
		const step = event.shiftKey ? 40 : 10;
		const changes: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const delta = changes[event.key];
		if (!delta) return;
		event.preventDefault();
		resize(note.id, note.width + delta[0], note.height + delta[1], true);
	}
</script>

<article
	use:noteInspector={{
		open: compact && inspecting && !presentation,
		label: note.title,
		close: () => (inspecting = false)
	}}
	style:display={hidden || (presentation && dirty) ? 'none' : undefined}
	class="note-card"
	class:dragging
	class:resizing
	class:inspecting={compact && inspecting}
	class:movable={editable && ready && !note.pinned}
	style:left="{note.x}px"
	style:top="{note.y}px"
	style:width="{note.width}px"
	style:height="{note.height}px"
	data-note-id={note.id}
	data-pinned={Boolean(note.pinned)}
	data-width={note.width}
	data-height={note.height}
	aria-label={note.title}
	tabindex="-1"
>
	{#if compact && !inspecting && !presentation}<button
			class="note-inspect"
			data-note-inspect
			aria-label={m.ux_open_note({ title: note.title })}
			onclick={() => (inspecting = true)}
		></button>{/if}
	{#if compact && inspecting}<header class="inspector-heading">
			<strong>{editable ? m.ux_note_editor() : m.ux_note_reader()}</strong>
			<button
				type="button"
				class="btn btn-sm"
				data-note-inspector-close
				onclick={() => (inspecting = false)}>{m.close()}</button
			>
		</header>{/if}
	{#if note.pinned}<span
			class="pin-indicator"
			role="img"
			aria-label={m.v2_note_pinned()}
			title={m.v2_note_pinned()}><Icon name="pin" size={16} /></span
		>{/if}
	<div class="note-topbar">
		<span class="visibility" title={visibility}>{visibility}</span>
		{#if !editable && !presentation && note.moderation === 'approved'}<span
				>{m.ux_note_approved_readonly()}</span
			>{/if}
		{#if dirty}<span class="unsaved">{m.v2_note_unsaved()}</span>{/if}
	</div>
	<div bind:this={element} class="note-editor" class:readonly={!editable}></div>
	{#if editable && !note.pinned}
		<button
			class="resize-handle"
			aria-label={m.v2_note_resize()}
			title={m.v2_note_resize_hint()}
			disabled={!ready}
			onpointerdown={startResize}
			onpointermove={(event) => moveResize(event)}
			onpointerup={(event) => moveResize(event, true)}
			onpointercancel={cancelResize}
			onlostpointercapture={cancelResize}
			onkeydown={keyResize}><Icon name="resize" size={16} /></button
		>
	{/if}
	<span class="note-dock-bridge" aria-hidden="true" style:--bridge-size="{12 / scale}px"></span>
	<div class="note-tools" use:noteDock>
		{#if conflict}<p class="conflict" role="status">
				{m.v2_note_conflict()} <button onclick={reload}>{m.v2_note_reload()}</button>
			</p>{/if}
		{#if editable || admin}
			<div class="note-actions">
				{#if editable}
					<IconButton
						icon="save"
						label={m.v2_note_save()}
						disabled={!ready || !dirty || conflict}
						onclick={save}
					/>
					{#if dirty}<IconButton icon="cancel" label={m.cancel()} onclick={reload} />{/if}
					<IconButton
						icon={note.pinned ? 'unpin' : 'pin'}
						label={note.pinned ? m.v2_note_unpin() : m.v2_note_pin()}
						aria-pressed={Boolean(note.pinned)}
						disabled={!ready}
						onclick={() => send('note.pin', { noteId: note.id, pinned: !note.pinned })}
					/>
				{/if}
				{#if admin}
					<IconButton
						icon={note.visible ? 'eyeClosed' : 'eye'}
						label={note.visible ? m.note_hide() : m.note_reveal()}
						disabled={!ready || dirty || note.moderation !== 'approved'}
						onclick={() => send('note.reveal', { noteId: note.id, visible: !note.visible })}
					/>
				{/if}
				<IconButton
					icon="more"
					label={m.v2_note_more()}
					class="more-options"
					onclick={() => element.querySelector<HTMLElement>('.tiptap')?.focus()}
				/>
			</div>
		{/if}
		{#if editable}
			{#if compact && inspecting}<details class="inspector-layout">
					<summary>{m.ux_note_layout()}</summary>
					<div class="note-actions">
						{#each nudges as nudge (nudge.symbol)}<button
								type="button"
								aria-label={nudge.label()}
								disabled={!ready || note.pinned}
								onclick={() => move(note.id, note.x + nudge.dx, note.y + nudge.dy, true)}
								>{nudge.symbol}</button
							>{/each}
					</div>
					<div class="note-actions">
						<label
							>{m.ux_note_width()}<input
								type="number"
								min={MIN_NOTE_WIDTH}
								max={MAX_NOTE_WIDTH}
								value={note.width}
								disabled={!ready || note.pinned}
								onchange={(event) =>
									resize(note.id, event.currentTarget.valueAsNumber, note.height, true)}
							/></label
						>
						<label
							>{m.ux_note_height()}<input
								type="number"
								min={MIN_NOTE_HEIGHT}
								max={MAX_NOTE_HEIGHT}
								value={note.height}
								disabled={!ready || note.pinned}
								onchange={(event) =>
									resize(note.id, note.width, event.currentTarget.valueAsNumber, true)}
							/></label
						>
					</div>
				</details>{/if}
			<div class="formatting advanced" aria-label={m.v2_note_formatting()}>
				<IconButton
					icon="heading"
					label="H1"
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
				/>
				<IconButton
					icon="bold"
					label={m.v2_bold()}
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleBold().run()}
				/>
				<IconButton
					icon="italic"
					label={m.v2_italic()}
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleItalic().run()}
				/>
				<IconButton
					icon="list"
					label={m.v2_list()}
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleBulletList().run()}
				/>
			</div>
		{/if}
		{#if editable || admin}
			<div class="note-actions advanced">
				{#if editable}<IconButton
						icon="trash"
						label={m.v2_delete()}
						disabled={!ready}
						onclick={() => send('note.delete', { noteId: note.id })}
					/>{/if}
				{#if admin}
					{#if note.moderation !== 'approved'}<IconButton
							icon="check"
							label={m.approve()}
							disabled={!ready || dirty}
							onclick={() => moderate('approved')}
						/>{/if}
					{#if note.moderation !== 'rejected'}<IconButton
							icon="cancel"
							label={m.reject()}
							disabled={!ready || dirty}
							onclick={() => moderate('rejected')}
						/>{/if}
				{/if}
			</div>
		{/if}
		{#if admin}
			<div class="note-links advanced">
				<select aria-label={m.v2_target_note()} bind:value={targetId}
					><option value="">{m.v2_link_to()}</option
					>{#each notes.filter((item) => item.id !== note.id) as other (other.id)}<option
							value={other.id}>{other.title}</option
						>{/each}</select
				>
				<select aria-label={m.v2_relation()} bind:value={relation}
					>{#each ['supports', 'contradicts', 'questions', 'extends', 'related'] as value (value)}<option
							{value}>{relationLabel(value as Relation)}</option
						>{/each}</select
				>
				<IconButton
					icon="link"
					label={m.v2_create_link()}
					disabled={!ready || !notes.some((item) => item.id === targetId)}
					onclick={() => send('edge.create', { from: note.id, to: targetId, relation, label: '' })}
				/>
			</div>
		{/if}
		{#if edges.some((edge) => edge.from === note.id)}
			<div class="note-links advanced">
				{#each edges.filter((edge) => edge.from === note.id) as edge (edge.id)}
					{#if admin}<IconButton
							icon="unlink"
							label={m.v2_delete_relation_link({ relation: relationLabel(edge.relation) })}
							disabled={!ready}
							onclick={() => send('edge.delete', { edgeId: edge.id })}
						/>{:else}<span>{relationLabel(edge.relation)}</span>{/if}
				{/each}
			</div>
		{/if}
	</div>
</article>

<style>
	.note-card {
		position: absolute;
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		color: var(--color-base-content);
		background: var(--color-base-100);
		border: 1px solid color-mix(in oklab, var(--color-base-content) 22%, transparent);
		border-radius: 16px;
		box-shadow: 0 8px 24px #0002;
		overflow: visible;
	}
	.pin-indicator {
		position: absolute;
		top: 8px;
		right: 8px;
		color: var(--color-base-content);
		pointer-events: none;
	}
	.note-card:hover,
	.note-card:focus-within,
	.resizing,
	.dragging {
		z-index: 2;
		border-color: var(--color-primary);
	}
	.note-topbar {
		display: flex;
		flex-shrink: 0;
		border-radius: 15px 15px 0 0;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		background: transparent;
		font-size: 11px;
	}
	.note-inspect {
		position: absolute;
		inset: 0;
		z-index: 3;
		width: 100%;
		height: 100%;
		border: 0;
		background: transparent;
	}
	.note-inspect:focus-visible {
		outline: 3px solid var(--color-primary);
	}
	:global(.mobile-note-dialog) {
		width: min(42rem, calc(100% - 24px));
		height: calc(100dvh - 24px);
		max-height: calc(100dvh - 24px);
		max-width: calc(100% - 24px);
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 16px;
		background: var(--color-base-100);
		color: var(--color-base-content);
	}
	:global(.mobile-note-dialog::backdrop) {
		background: #0006;
	}
	.note-card.inspecting {
		position: relative;
		left: auto !important;
		top: auto !important;
		width: 100% !important;
		height: 100% !important;
		overflow: auto;
	}
	.inspector-heading {
		position: sticky;
		top: 0;
		z-index: 4;
		flex-shrink: 0;
		background: var(--color-base-100);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-base-300);
	}
	.inspecting .note-tools {
		display: flex;
		position: static;
		flex-shrink: 0;
		box-shadow: none;
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: none;
		padding: 8px;
		transition: none;
	}
	.inspecting .note-editor {
		min-height: 120px;
	}
	.inspecting .resize-handle {
		display: none;
	}
	.inspecting :global(.icon-button),
	.inspecting button,
	.inspecting select {
		min-width: 44px;
		min-height: 44px;
	}
	.inspector-layout summary {
		min-height: 44px;
		padding: 12px;
		cursor: pointer;
		font-size: 13px;
	}
	.inspector-layout label {
		flex: 1;
		min-width: 0;
	}
	.inspector-layout input {
		display: block;
		width: 100%;
		min-height: 44px;
		padding: 8px;
		border: 1px solid var(--color-base-300);
		border-radius: 4px;
		background: var(--color-base-200);
		color: var(--color-base-content);
	}
	.note-tools {
		display: flex;
		flex-direction: column;
		gap: 8px;
		position: absolute;
		top: var(--dock-top, calc(100% + 10px));
		left: var(--dock-left, 0px);
		width: var(--dock-width, 100%);
		max-height: var(--dock-height, none);
		overflow-y: auto;
		overflow-x: hidden;
		padding: 4px;
		background: transparent;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateY(-6px);
		transition:
			opacity 160ms ease,
			transform 180ms ease,
			visibility 0s linear 160ms;
	}
	.note-dock-bridge {
		display: none;
		position: absolute;
		bottom: calc(-1 * var(--bridge-size));
		left: 0;
		right: 0;
		height: var(--bridge-size);
		pointer-events: auto;
	}
	.note-card:global([data-dock-placement]):is(:hover, :focus-within) .note-dock-bridge {
		display: block;
	}
	.note-card:global([data-dock-placement='above']) .note-dock-bridge {
		top: calc(-1 * var(--bridge-size));
		bottom: auto;
	}
	.note-card:hover .note-topbar,
	.note-card:focus-within .note-topbar {
		display: flex;
	}
	.note-card:hover .note-tools,
	.note-card:focus-within .note-tools {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: none;
		transition-delay: 0s;
	}
	.visibility {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.unsaved {
		font-weight: 600;
	}
	.formatting,
	.note-actions,
	.note-links {
		display: flex;
		align-items: center;
		align-self: center;
		width: max-content;
		max-width: 100%;
		gap: 6px;
		flex-wrap: wrap;
		padding: 6px;
		border: 1px solid color-mix(in oklab, var(--color-base-content) 14%, transparent);
		border-radius: 16px;
		background: color-mix(in oklab, var(--color-base-100) 88%, transparent);
		backdrop-filter: blur(16px);
		box-shadow: 0 6px 20px #0002;
		font-size: 11px;
	}
	.note-tools :global(.icon-button) {
		border-color: transparent;
		border-radius: 10px;
		color: var(--color-base-content);
		background: transparent;
		transition:
			transform 150ms ease,
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.note-tools :global(.icon-button:hover:not(:disabled)) {
		transform: translateY(-3px) scale(1.08);
		background: var(--color-base-200);
		box-shadow: 0 4px 10px #0002;
	}
	.note-tools :global(.icon-button:active:not(:disabled)) {
		transform: translateY(0) scale(0.96);
	}
	.note-tools :global(.icon-button[aria-pressed='true']) {
		color: var(--color-primary);
		background: color-mix(in oklab, var(--color-primary) 15%, var(--color-base-100));
	}
	button {
		border: 1px solid var(--color-base-300);
		border-radius: 4px;
		padding: 2px 5px;
		cursor: pointer;
		background: var(--color-base-200);
		color: var(--color-base-content);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.note-editor {
		flex: 1;
		min-height: 60px;
		overflow: auto;
		padding: 16px;
		border-radius: inherit;
		cursor: text;
	}
	.resize-handle {
		position: absolute;
		bottom: 4px;
		right: 4px;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		opacity: 0;
		cursor: nwse-resize;
		touch-action: none;
	}
	.note-card:hover .resize-handle,
	.note-card:focus-within .resize-handle,
	.resizing .resize-handle {
		opacity: 1;
	}
	.note-card .resize-handle {
		cursor: nwse-resize;
	}
	.note-editor.readonly {
		cursor: default;
	}
	.movable .note-editor {
		cursor: grab;
		touch-action: none;
	}
	.movable .note-editor:focus-within {
		cursor: text;
		touch-action: pan-y;
	}
	.dragging .note-editor {
		cursor: grabbing;
		user-select: none;
	}
	.note-editor :global(.tiptap) {
		outline: none;
		min-height: 100%;
		overflow-wrap: anywhere;
		font-size: 14px;
		line-height: 1.5;
	}
	.note-editor :global(h1) {
		font-size: 23px;
		font-weight: 700;
		margin: 0 0 8px;
	}
	.note-editor :global(h2) {
		font-size: 19px;
		font-weight: 600;
	}
	.note-editor :global(h3) {
		font-size: 16px;
		font-weight: 600;
	}
	.note-editor :global(p) {
		margin: 0 0 6px;
	}
	.note-editor :global(ul) {
		list-style: disc;
		padding-left: 20px;
	}
	.note-editor :global(ol) {
		list-style: decimal;
		padding-left: 20px;
	}
	.note-editor :global(pre) {
		background: var(--color-base-200);
		padding: 6px;
		white-space: pre-wrap;
	}
	.note-editor :global(blockquote) {
		border-left: 3px solid var(--color-base-300);
		padding-left: 8px;
	}
	.note-links select {
		min-width: 0;
		max-width: 130px;
		background-color: var(--color-base-200);
		color: var(--color-base-content);
		border-radius: 8px;
		padding-inline: 8px 26px;
		min-height: 30px;
	}
	.conflict {
		font-size: 11px;
		color: var(--color-base-content);
		background: var(--color-base-100);
		border: 1px solid var(--color-warning);
		border-radius: 12px;
		padding: 4px 10px;
	}
	.note-tools .advanced {
		display: none;
	}
	.note-card:focus-within .advanced {
		display: flex;
	}
	@media (hover: none) {
		.note-card:focus-within .note-topbar {
			display: flex;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.note-tools,
		.note-tools :global(.icon-button) {
			transition: none;
		}
		.note-tools :global(.icon-button:hover:not(:disabled)),
		.note-tools :global(.icon-button:active:not(:disabled)) {
			transform: none;
		}
	}
</style>
