<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { EdgeModel, NoteModel, Relation } from './models';

	let {
		note,
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
			? note.moderation
			: !note.visible
				? 'Hidden — only admin / author'
				: audienceEnabled
					? 'Visible to spectators'
					: 'Revealed — spectators disabled'
	);

	onMount(() => {
		confirmedMarkdown = note.markdown;
		draft = note.markdown;
		baseVersion = note.version;
		const instance = new Editor({
			element,
			extensions: [
				StarterKit.configure({ link: { openOnClick: false }, heading: { levels: [1, 2, 3] } }),
				Markdown
			],
			content: note.markdown,
			contentType: 'markdown',
			editable: editable && ready,
			editorProps: {
				attributes: { role: 'textbox', 'aria-label': 'Note content', 'aria-multiline': 'true' }
			},
			onUpdate: ({ editor: current }) => {
				draft = current.getMarkdown();
				dirty = draft !== confirmedMarkdown;
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
			events.abort();
			drag = null;
			editor = null;
			instance.destroy();
		};
	});

	$effect(() => {
		editor?.setEditable(editable && ready, false);
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
		} else if (note.version !== baseVersion) {
			conflict = true;
		}
	});

	function reload() {
		if (!editor) return;
		editor.commands.setContent(note.markdown, { contentType: 'markdown', emitUpdate: false });
		confirmedMarkdown = note.markdown;
		draft = note.markdown;
		baseVersion = note.version;
		dirty = false;
		conflict = false;
	}

	function moderate(decision: 'approved' | 'rejected') {
		// Keep focus inside the card when the clicked moderation button disappears.
		element.querySelector<HTMLElement>('.tiptap')?.focus();
		send('note.moderate', { noteId: note.id, decision });
	}

	function startDrag(event: PointerEvent) {
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
	class="note-card"
	class:dragging
	class:resizing
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
>
	{#if note.pinned}<span
			class="pin-indicator"
			role="img"
			aria-label="Pinned note"
			title="Pinned note"><Icon name="pin" size={16} /></span
		>{/if}
	<div class="note-topbar">
		<span class="visibility" title={visibility}>{visibility}</span>
		{#if dirty}<span class="unsaved">Unsaved</span>{/if}
	</div>
	<div bind:this={element} class="note-editor" class:readonly={!editable}></div>
	{#if editable && !note.pinned}
		<button
			class="resize-handle"
			aria-label="Resize note"
			title="Resize note · drag or use arrow keys"
			disabled={!ready}
			onpointerdown={startResize}
			onpointermove={(event) => moveResize(event)}
			onpointerup={(event) => moveResize(event, true)}
			onpointercancel={cancelResize}
			onlostpointercapture={cancelResize}
			onkeydown={keyResize}><Icon name="resize" size={16} /></button
		>
	{/if}
	<div class="note-tools">
		{#if conflict}<p class="conflict" role="status">
				Remote change. Draft kept. <button onclick={reload}>Reload saved content</button>
			</p>{/if}
		{#if editable || admin}
			<div class="note-actions">
				{#if editable}
					<IconButton
						icon="save"
						label="Save note"
						disabled={!ready || !dirty || conflict}
						onclick={() =>
							send('note.update', { noteId: note.id, version: baseVersion, markdown: draft })}
					/>
					{#if dirty}<IconButton icon="cancel" label="Cancel" onclick={reload} />{/if}
					<IconButton
						icon={note.pinned ? 'unpin' : 'pin'}
						label={note.pinned ? 'Unpin note' : 'Pin note'}
						aria-pressed={Boolean(note.pinned)}
						disabled={!ready}
						onclick={() => send('note.pin', { noteId: note.id, pinned: !note.pinned })}
					/>
				{/if}
				{#if admin}
					<IconButton
						icon={note.visible ? 'eyeClosed' : 'eye'}
						label={note.visible ? 'Hide' : 'Reveal'}
						disabled={!ready || dirty || note.moderation !== 'approved'}
						onclick={() => send('note.reveal', { noteId: note.id, visible: !note.visible })}
					/>
				{/if}
				<IconButton
					icon="more"
					label="More note options"
					class="more-options"
					onclick={() => element.querySelector<HTMLElement>('.tiptap')?.focus()}
				/>
			</div>
		{/if}
		{#if editable}
			<div class="formatting advanced" aria-label="Text formatting">
				<IconButton
					icon="heading"
					label="H1"
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
				/>
				<IconButton
					icon="bold"
					label="Bold"
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleBold().run()}
				/>
				<IconButton
					icon="italic"
					label="Italic"
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleItalic().run()}
				/>
				<IconButton
					icon="list"
					label="Bullet list"
					disabled={!ready}
					onclick={() => editor?.chain().focus().toggleBulletList().run()}
				/>
			</div>
		{/if}
		{#if editable || admin}
			<div class="note-actions advanced">
				{#if editable}<IconButton
						icon="trash"
						label="Delete"
						disabled={!ready}
						onclick={() => send('note.delete', { noteId: note.id })}
					/>{/if}
				{#if admin}
					{#if note.moderation !== 'approved'}<IconButton
							icon="check"
							label="Approve"
							disabled={!ready || dirty}
							onclick={() => moderate('approved')}
						/>{/if}
					{#if note.moderation !== 'rejected'}<IconButton
							icon="cancel"
							label="Reject"
							disabled={!ready || dirty}
							onclick={() => moderate('rejected')}
						/>{/if}
				{/if}
			</div>
		{/if}
		{#if admin}
			<div class="note-links advanced">
				<select aria-label="Target note" bind:value={targetId}
					><option value="">Link to…</option
					>{#each notes.filter((item) => item.id !== note.id) as other (other.id)}<option
							value={other.id}>{other.title}</option
						>{/each}</select
				>
				<select aria-label="Relation" bind:value={relation}
					>{#each ['supports', 'contradicts', 'questions', 'extends', 'related'] as value (value)}<option
							{value}>{value}</option
						>{/each}</select
				>
				<IconButton
					icon="link"
					label="Create link"
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
							label="Delete {edge.relation} link"
							disabled={!ready}
							onclick={() => send('edge.delete', { edgeId: edge.id })}
						/>{:else}<span>{edge.relation}</span>{/if}
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
		color: #1f2937;
		background: white;
		border: 1px solid #94a3b8;
		border-radius: 12px;
		box-shadow: 0 4px 16px #0002;
		overflow: visible;
	}
	.pin-indicator {
		position: absolute;
		top: 8px;
		right: 8px;
		color: #64748b;
		pointer-events: none;
	}
	.note-card:hover,
	.note-card:focus-within,
	.resizing,
	.dragging {
		z-index: 2;
		border-color: #3b82f6;
	}
	.note-topbar {
		display: none;
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		border-radius: 6px 6px 0 0;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: #f1f5f9;
		font-size: 11px;
	}
	.note-tools {
		display: none;
		position: absolute;
		top: 100%;
		left: -1px;
		right: -1px;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 0 0 8px 8px;
		box-shadow: 0 5px 12px #0001;
	}
	.note-card:hover .note-topbar,
	.note-card:focus-within .note-topbar {
		display: flex;
	}
	.note-card:hover .note-tools,
	.note-card:focus-within .note-tools {
		display: block;
	}
	.visibility {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.unsaved {
		color: #92400e;
	}
	.formatting,
	.note-actions,
	.note-links {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		padding: 5px 9px;
		border-top: 1px solid #e2e8f0;
		font-size: 11px;
	}
	button {
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		padding: 2px 5px;
		cursor: pointer;
		background: #f8fafc;
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
		background: #f1f5f9;
		padding: 6px;
		white-space: pre-wrap;
	}
	.note-editor :global(blockquote) {
		border-left: 3px solid #cbd5e1;
		padding-left: 8px;
	}
	.note-links select {
		min-width: 0;
		max-width: 130px;
		background: #f1f5f9;
		border-radius: 4px;
	}
	.conflict {
		font-size: 11px;
		color: #9a3412;
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
</style>
