<script lang="ts">
	import { onMount } from 'svelte';
	import { CanvasWorkspace, type EdgeModel, type NoteModel } from '$lib/canvas/workspace.svelte';
	import {
		createCamera,
		WORLD_WIDTH,
		WORLD_HEIGHT,
		type Camera,
		type Viewport
	} from '$lib/canvas/camera';
	import NoteCard from '$lib/canvas/NoteCard.svelte';
	import PeopleMenu from '$lib/canvas/PeopleMenu.svelte';
	import SpectrumBoard from '$lib/canvas/SpectrumBoard.svelte';
	import ChatPanel from '$lib/canvas/ChatPanel.svelte';
	import VoiceMenu from '$lib/canvas/VoiceMenu.svelte';
	import type { VoiceCredentials, VoiceError } from '$lib/canvas/voice-connection';
	import type { ChatState, ChatError } from '$lib/canvas/chat-state';
	import { nextNotePosition, revealNote } from '$lib/canvas/placement';
	import { clampNoteSize } from '$lib/canvas/note-layout';
	import { loadSpectrumCells, type SpectrumCell } from '$lib/canvas/cells';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { RoomClient, type RoomState, type SpectrumState } from '$lib/canvas/room-client';

	let container: HTMLDivElement;
	let workspace: CanvasWorkspace | null = null;
	let client: RoomClient | null = null;
	let notes = $state<NoteModel[]>([]);
	let edges = $state<EdgeModel[]>([]);
	let room = $state<RoomState | null>(null);
	let spectrum = $state<SpectrumState | null>(null);
	let spectrumImage = '';
	let spectrumCells = $state<SpectrumCell[]>([]);
	let chat = $state<ChatState | null>(null);
	let chatError = $state<ChatError | null>(null);
	let voiceCredentials = $state<VoiceCredentials | null>(null);
	let voiceFailure = $state<VoiceError | null>(null);
	let voiceInvalidation = $state(0);
	let status = $state('Connecting');
	let error = $state('');
	let roomInput = $state('');
	let camera = $state<Camera>(createCamera());
	let viewport = $state<Viewport>({ width: 0, height: 0 });
	const admin = $derived(room?.role === 'admin');
	const ready = $derived(status === 'Connected' && room !== null);
	const pendingNotes = $derived(notes.filter((note) => note.moderation === 'pending'));
	const worldTransform = $derived(
		`translate(${viewport.width / 2 - camera.x * camera.scale}px, ${viewport.height / 2 - camera.y * camera.scale}px) scale(${camera.scale})`
	);

	function canEdit(note: NoteModel): boolean {
		return (
			room?.role === 'admin' ||
			(room?.role === 'participant' &&
				note.authorId === room.userId &&
				note.moderation !== 'approved')
		);
	}

	onMount(() => {
		let destroyed = false;
		let instance: CanvasWorkspace | null = null;
		void (async () => {
			try {
				instance = await CanvasWorkspace.create(container);
				if (destroyed) {
					instance.destroy();
					return;
				}
				workspace = instance;
				instance.useHTMLNotes();
				loadSpectrumImage(7);
				instance.onViewChanged((value, size) => {
					camera = value;
					viewport = size;
				});
				let userId = sessionStorage.getItem('spectrum-v2-user');
				if (!userId) {
					userId = crypto.randomUUID();
					sessionStorage.setItem('spectrum-v2-user', userId);
				}
				roomInput = new URL(location.href).searchParams.get('room') ?? '';
				client = new RoomClient(userId, roomInput, {
					status: (value) => {
						status = value;
						if (value !== 'Connected') {
							spectrum = null;
							chat = null;
						}
					},
					error: (value) => {
						error = value;
					},
					chat: (value) => {
						chat = value;
					},
					chatError: (value) => {
						chatError = value;
					},
					roomClosed: () => {
						voiceCredentials = null;
						voiceFailure = null;
						voiceInvalidation++;
						room = null;
						spectrum = null;
						chat = null;
						chatError = null;
						notes = [];
						edges = [];
						roomInput = '';
						instance?.setNotes([]);
						instance?.setEdges([]);
						const url = new URL(location.href);
						url.searchParams.delete('room');
						history.replaceState(null, '', url);
					},
					room: (value) => {
						room = value;
						spectrum = value.spectrum ?? null;
						loadSpectrumImage(spectrum?.sliceCount ?? 7);
						roomInput = value.roomId;
						const url = new URL(location.href);
						url.searchParams.set('room', value.roomId);
						history.replaceState(null, '', url);
					},
					voice: (value) => {
						voiceCredentials = value;
					},
					voiceError: (value) => {
						voiceFailure = value;
					},
					voiceInvalidated: () => {
						voiceCredentials = null;
						voiceInvalidation++;
					},
					spectrum: (value) => {
						spectrum = value;
						loadSpectrumImage(value.sliceCount);
					},
					snapshot: (snapshot) => {
						notes = (snapshot.notes ?? []).toSorted(
							(a, b) =>
								(a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)
						);
						edges = snapshot.edges ?? [];
						instance?.setNotes(notes);
						instance?.setEdges(edges);
					}
				});
				client.connect();
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		})();
		return () => {
			destroyed = true;
			client?.destroy();
			instance?.destroy();
			workspace = null;
		};
	});

	function loadSpectrumImage(slices: number) {
		const source =
			slices === 3
				? m.file_spectrum_3()
				: slices === 5
					? m.file_spectrum_5()
					: slices === 9
						? m.file_spectrum_9()
						: m.file_spectrum();
		if (!workspace || source === spectrumImage) return;
		spectrumImage = source;
		const target = workspace;
		void Promise.all([target.setSpectrumImage(source), loadSpectrumCells(source)])
			.then(([, cells]) => {
				if (workspace === target && spectrumImage === source) spectrumCells = cells;
			})
			.catch((cause) => {
				if (workspace === target) {
					spectrumImage = '';
					error = String(cause);
				}
			});
	}

	function send(op: string, payload: unknown = {}) {
		error = '';
		if (op === 'chat.send') chatError = null;
		if (op === 'voice.join') voiceFailure = null;
		const sent = client?.send(op, payload) ?? false;
		if (!sent) error = 'Connection unavailable';
		return sent;
	}
	function addNote() {
		const { x, y } = nextNotePosition(camera, notes);
		workspace?.setCamera(revealNote(camera, viewport, { x, y }));
		send('note.create', { markdown: '# New note\n\nWrite the idea here.', color: '#64748b', x, y });
	}
	function moveNote(id: string, x: number, y: number, done: boolean) {
		const note = notes.find((value) => value.id === id);
		if (!note || note.pinned || !canEdit(note) || !ready) return;
		x = Math.max(-WORLD_WIDTH / 2, Math.min(WORLD_WIDTH / 2 - note.width, x));
		y = Math.max(-WORLD_HEIGHT / 2, Math.min(WORLD_HEIGHT / 2 - note.height, y));
		notes = notes.map((value) => (value.id === id ? { ...value, x, y } : value));
		workspace?.previewNoteMove(id, x, y);
		if (done) send('note.move', { noteId: id, x, y });
	}
	function resizeNote(id: string, width: number, height: number, done: boolean) {
		const note = notes.find((value) => value.id === id);
		if (!note || note.pinned || !canEdit(note) || !ready) return;
		const size = clampNoteSize(note, width, height);
		notes = notes.map((value) => (value.id === id ? { ...value, ...size } : value));
		workspace?.previewNoteResize(id, size.width, size.height);
		if (done) send('note.resize', { noteId: id, ...size });
	}
</script>

<svelte:head><title>Spectrum v2 — canvas</title></svelte:head>

<div class="bg-base-200 flex h-dvh w-full flex-col">
	<header class="border-base-300 bg-base-100 flex flex-wrap items-center gap-2 border-b px-4 py-2">
		<span class="text-lg font-semibold">Spectrum v2</span>
		<span class="badge badge-ghost badge-sm">{status}</span>
		{#if room}<span class="badge badge-sm" data-testid="own-role">{room.role}</span><span
				class="text-sm">Room {room.roomId}</span
			>{/if}
		<span class="grow"></span>
		{#if room}<PeopleMenu {room} {ready} {send} />{/if}
		{#if room?.voice?.available}<VoiceMenu
				{room}
				{ready}
				credentials={voiceCredentials}
				failure={voiceFailure}
				invalidation={voiceInvalidation}
				{send}
			/>{/if}
		{#if room}<ChatPanel {room} {ready} {chat} error={chatError} {send} />{/if}
		{#if admin && pendingNotes.length}
			<details class="relative z-10">
				<summary
					class="btn btn-sm btn-ghost"
					aria-label="Pending notes ({pendingNotes.length})"
					title="Pending notes"
					><Icon name="review" /><span class="text-xs">{pendingNotes.length}</span></summary
				>
				<ul
					class="bg-base-100 absolute right-0 mt-1 max-h-[60dvh] w-72 space-y-1 overflow-y-auto rounded border p-3 shadow"
				>
					{#each pendingNotes as note (note.id)}
						<li class="flex items-center gap-1 text-sm">
							<button
								class="min-w-0 flex-1 truncate text-left"
								title="Go to note"
								onclick={() =>
									workspace?.setCamera({
										x: note.x + note.width / 2,
										y: note.y + note.height / 2,
										scale: Math.max(camera.scale, 0.8)
									})}>{note.title}</button
							>
							<IconButton
								icon="check"
								label="Approve {note.title}"
								disabled={!ready}
								onclick={() => send('note.moderate', { noteId: note.id, decision: 'approved' })}
							/>
							<IconButton
								icon="cancel"
								label="Reject {note.title}"
								disabled={!ready}
								onclick={() => send('note.moderate', { noteId: note.id, decision: 'rejected' })}
							/>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if !room}
			<input
				class="input input-sm w-36"
				aria-label="Room ID"
				bind:value={roomInput}
				placeholder="Room ID"
			/>
			<button
				class="btn btn-sm"
				disabled={status !== 'Connected' || !roomInput.trim()}
				onclick={() => send('room.join', { roomId: roomInput.trim() })}>Join room</button
			>
			<button
				class="btn btn-sm btn-primary"
				disabled={status !== 'Connected'}
				onclick={() => send('room.create')}><Icon name="plus" /> Create room</button
			>
		{/if}
		{#if admin}<details class="relative z-10">
				<summary class="btn btn-sm btn-ghost" aria-label="Room options" title="Room options"
					><Icon name="settings" /></summary
				>
				<div class="bg-base-100 absolute right-0 mt-1 w-64 rounded border p-3 shadow">
					<label class="mb-3 flex items-center gap-2 text-xs"
						><input
							type="checkbox"
							class="checkbox checkbox-xs"
							checked={room?.settings.spectatorChatEnabled}
							disabled={!ready}
							onchange={(event) =>
								send('room.settings', { spectatorChatEnabled: event.currentTarget.checked })}
						/>Allow spectator chat</label
					>
					<label class="flex items-center gap-2 text-xs"
						><input
							type="checkbox"
							class="checkbox checkbox-xs"
							checked={room?.settings.notesVisibleToSpectators}
							disabled={!ready}
							onchange={(event) =>
								send('room.settings', { notesVisibleToSpectators: event.currentTarget.checked })}
						/>Show revealed notes to spectators</label
					>
					<label class="mt-3 flex items-center gap-2 text-xs"
						><input
							type="checkbox"
							class="checkbox checkbox-xs"
							checked={room?.settings.pelletsVisibleToSpectators}
							disabled={!ready}
							onchange={(event) =>
								send('room.settings', { pelletsVisibleToSpectators: event.currentTarget.checked })}
						/>Show positions to spectators</label
					>
					<label class="mt-3 flex items-center gap-2 text-xs"
						><input
							type="checkbox"
							class="checkbox checkbox-xs"
							checked={spectrum?.hidden ?? false}
							disabled={!ready}
							onchange={(event) =>
								send('room.settings', { pelletsHidden: event.currentTarget.checked })}
						/>Hide everyone's positions</label
					>
					<div class="mt-3">
						<IconButton
							icon="reset"
							label="Reset positions"
							disabled={!ready}
							onclick={() => send('spectrum.reset')}
						/>
					</div>
				</div>
			</details>{/if}
		<details class="relative z-10">
			<summary class="btn btn-sm btn-ghost" aria-label="View" title="View"
				><Icon name="frame" /></summary
			>
			<div class="bg-base-100 absolute right-0 mt-1 flex w-64 gap-1 rounded border p-2 shadow">
				<IconButton icon="plus" label="Zoom +" onclick={() => workspace?.zoomBy(1.2)} />
				<IconButton icon="minus" label="Zoom −" onclick={() => workspace?.zoomBy(1 / 1.2)} />
				<IconButton icon="frame" label="Reset view" onclick={() => workspace?.fitToSpectrum()} />
			</div>
		</details>
		<IconButton
			icon="plus"
			label="New note"
			disabled={!ready || room?.role === 'spectator'}
			onclick={addNote}
		/>
	</header>
	{#if error}<div role="alert" class="alert alert-error rounded-none py-2">{error}</div>{/if}
	<div class="relative min-h-0 grow overflow-hidden">
		<div bind:this={container} class="h-full w-full"></div>
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="absolute top-0 left-0 origin-top-left" style:transform={worldTransform}>
				{#if room && spectrum}<SpectrumBoard
						state={spectrum}
						cells={spectrumCells}
						{room}
						{ready}
						scale={camera.scale}
						{send}
					/>{/if}
				{#each notes as note (note.id)}
					<NoteCard
						{note}
						editable={canEdit(note)}
						{admin}
						{ready}
						audienceEnabled={room?.settings.notesVisibleToSpectators ?? false}
						{notes}
						{edges}
						scale={camera.scale}
						{send}
						move={moveNote}
						resize={resizeNote}
					/>
				{/each}
			</div>
		</div>
		<div
			class="bg-base-100/90 pointer-events-none absolute bottom-3 left-3 rounded px-3 py-2 text-xs"
			role="status"
		>
			Notes ({notes.length}) · Links ({edges.length}) · {Math.round(camera.scale * 100)}%
			{#if room && !notes.length}<span class="block opacity-70"
					>{admin ? 'Add a note to begin.' : 'Waiting for revealed notes.'}</span
				>{/if}
		</div>
	</div>
</div>
