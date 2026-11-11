<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { CanvasWorkspace, type EdgeModel, type NoteModel } from '$lib/canvas/workspace.svelte';
	import {
		createCamera,
		WORLD_WIDTH,
		WORLD_HEIGHT,
		MIN_SCALE,
		MAX_SCALE,
		type Camera,
		type Viewport
	} from '$lib/canvas/camera';
	import NoteCard from '$lib/canvas/NoteCard.svelte';
	import NoteNavigator from '$lib/canvas/NoteNavigator.svelte';
	import { NoteDrafts } from '$lib/canvas/note-drafts';
	import { roomErrorLabel } from '$lib/canvas/room-error-label';
	import PeopleMenu from '$lib/canvas/PeopleMenu.svelte';
	import SpectrumBoard from '$lib/canvas/SpectrumBoard.svelte';
	import DiscussionPanel from '$lib/canvas/DiscussionPanel.svelte';
	import ClaimBar from '$lib/canvas/ClaimBar.svelte';
	import RoomLobby from '$lib/canvas/RoomLobby.svelte';
	import RoomOptions from '$lib/canvas/RoomOptions.svelte';
	import PendingNotesMenu from '$lib/canvas/PendingNotesMenu.svelte';
	import SessionMenu from '$lib/canvas/SessionMenu.svelte';
	import RoomTimer from '$lib/canvas/RoomTimer.svelte';
	import SocialControls from '$lib/canvas/SocialControls.svelte';
	import AppMenu from '$lib/canvas/AppMenu.svelte';
	import ShareDialog from '$lib/canvas/ShareDialog.svelte';
	import LiveMenu from '$lib/canvas/LiveMenu.svelte';
	import { roleLabel } from '$lib/canvas/labels';
	import { publicNote, publicSpectrum } from '$lib/canvas/presentation';
	import { ActivityTracker, type ActivityEntry } from '$lib/canvas/activity-state';
	import VoiceMenu from '$lib/canvas/VoiceMenu.svelte';
	import type { TranscriptState } from '$lib/canvas/transcript-state';
	import type { BrowserTranscriptSession, BrowserTranscriptFailure } from '$lib/canvas/browser-stt';
	import type { VoiceConnection, VoiceCredentials, VoiceError } from '$lib/canvas/voice-connection';
	import type { ChatState, ChatError } from '$lib/canvas/chat-state';
	import { nextNotePosition, revealNote, focusNote } from '$lib/canvas/placement';
	import { clampNoteSize } from '$lib/canvas/note-layout';
	import { createCellDetector, loadSpectrumGraphic, type SpectrumCell } from '$lib/canvas/cells';
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import {
		RoomClient,
		type RoomState,
		type SpectrumState,
		type ReactionEvent,
		type LiveState
	} from '$lib/canvas/room-client';

	let container: HTMLDivElement;
	let workspace = $state.raw<CanvasWorkspace | null>(null);
	let client: RoomClient | null = null;
	let activityTracker = $state.raw<ActivityTracker | null>(null);
	let activity = $state<ActivityEntry[]>([]);
	let notes = $state<NoteModel[]>([]);
	const noteDrafts = new NoteDrafts();
	let edges = $state<EdgeModel[]>([]);
	let room = $state<RoomState | null>(null);
	let roomConfirmed = $state(false);
	let spectrum = $state<SpectrumState | null>(null);
	let spectrumImage = '';
	let spectrumCells = $state<SpectrumCell[]>([]);
	let spectrumLabels = $state('');
	let chat = $state<ChatState | null>(null);
	let transcript = $state<TranscriptState | null>(null);
	let chatError = $state<ChatError | null>(null);
	let voiceCredentials = $state<VoiceCredentials | null>(null);
	let voiceFailure = $state<VoiceError | null>(null);
	let browserSession = $state<BrowserTranscriptSession | null>(null);
	let browserFailure = $state<BrowserTranscriptFailure | null>(null);
	let voiceInvalidation = $state(0);
	let voiceConnection = $state.raw<VoiceConnection | null>(null);
	let speakers = $state<string[]>([]);
	let reaction = $state<ReactionEvent | null>(null);
	let live = $state<LiveState | null>(null);
	let shareOpen = $state(false);
	let presentation = $state(false);
	let status = $state('Connecting');
	let error = $state('');
	let roomInput = $state('');
	let createSlices = $state(7);
	let createNeutralCircle = $state(true);
	let createTopic = $state('');
	let discussionOpen = $state(false);
	let discussionUnread = $state(0);
	let camera = $state<Camera>(createCamera());
	let viewport = $state<Viewport>({ width: 0, height: 0 });
	const admin = $derived(room?.role === 'admin');
	const ready = $derived(status === 'Connected' && room !== null && roomConfirmed);
	const pendingNotes = $derived(notes.filter((note) => note.moderation === 'pending'));
	const projectedNoteIds = $derived(
		new Set(
			notes
				.filter((note) => publicNote(note, room?.settings.notesVisibleToSpectators ?? false))
				.map((note) => note.id)
		)
	);
	$effect(() => {
		workspace?.setVisibleNoteIds(presentation ? projectedNoteIds : null);
	});
	$effect(() => {
		if (presentation)
			document.querySelector<HTMLButtonElement>('[data-testid="presentation-exit"]')?.focus();
	});
	async function exitPresentation() {
		presentation = false;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="app-menu"]')?.focus();
	}
	const activityCellDetector = $derived(
		spectrumCells.length ? createCellDetector(spectrumCells) : null
	);
	$effect(() => {
		activityTracker?.update(ready ? room : null, ready ? spectrum : null, activityCellDetector);
		activityTracker?.observeLive(ready ? live : null);
	});
	$effect(() => {
		if (!room) loadSpectrumImage(createSlices, createNeutralCircle);
	});
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
		const tracker = new ActivityTracker((entries) => {
			activity = entries;
		});
		activityTracker = tracker;
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
				loadSpectrumImage(createSlices, createNeutralCircle);
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
							roomConfirmed = false;
							browserSession = null;
							browserFailure = null;
							spectrum = null;
							chat = null;
							transcript = null;
							live = null;
						}
					},
					error: (value) => {
						error = roomErrorLabel(value);
					},
					chat: (value) => {
						chat = value;
					},
					transcript: (value) => {
						transcript = value;
					},
					chatError: (value) => {
						chatError = value;
					},
					reaction: (value) => {
						reaction = value;
						tracker.reaction(value);
					},
					live: (value) => {
						live = value;
					},
					roomClosed: () => {
						roomConfirmed = false;
						noteDrafts.clear();
						browserSession = null;
						browserFailure = null;
						error = '';
						tracker.clear();
						transcript = null;
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
						discussionOpen = false;
						discussionUnread = 0;
						live = null;
						shareOpen = false;
						presentation = false;
						reaction = null;
						speakers = [];
						instance?.setNotes([]);
						instance?.setEdges([]);
						const url = new URL(location.href);
						url.searchParams.delete('room');
						history.replaceState(null, '', url);
					},
					room: (value) => {
						noteDrafts.enter(value);
						if (!room) createTopic = '';
						room = value;
						roomConfirmed = true;
						spectrum = value.spectrum ?? null;
						loadSpectrumImage(spectrum?.sliceCount ?? 7, spectrum?.showNeutralCircle ?? true);
						roomInput = value.roomId;
						const url = new URL(location.href);
						url.searchParams.set('room', value.roomId);
						history.replaceState(null, '', url);
					},
					voice: (value) => {
						voiceCredentials = value;
					},
					browserTranscript: (value) => {
						browserSession = value;
					},
					browserTranscriptError: (value) => {
						browserFailure = value;
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
						loadSpectrumImage(value.sliceCount, value.showNeutralCircle ?? true);
					},
					snapshot: (snapshot) => {
						notes = (snapshot.notes ?? []).toSorted(
							(a, b) =>
								(a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)
						);
						edges = snapshot.edges ?? [];
						// Disconnect clears rendered cards, not RAM drafts. Only a fresh
						// authorized snapshot may discard deleted or no-longer-editable drafts.
						if (status === 'Connected' && room) noteDrafts.reconcile(notes, room);
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
			noteDrafts.clear();
			destroyed = true;
			tracker.destroy();
			activityTracker = null;
			client?.destroy();
			instance?.destroy();
			workspace = null;
		};
	});

	function loadSpectrumImage(slices: number, showNeutralCircle: boolean) {
		const source =
			slices === 3
				? m.file_spectrum_3()
				: slices === 5
					? m.file_spectrum_5()
					: slices === 9
						? m.file_spectrum_9()
						: m.file_spectrum();
		const key = `${source}:${showNeutralCircle}`;
		if (!workspace || key === spectrumImage) return;
		spectrumImage = key;
		spectrumCells = [];
		spectrumLabels = '';
		const target = workspace;
		void loadSpectrumGraphic(source, showNeutralCircle)
			.then(async ({ imageSource, labelSource, cells }) => {
				if (workspace !== target || spectrumImage !== key) return;
				await target.setSpectrumImage(imageSource);
				if (workspace === target && spectrumImage === key) {
					spectrumCells = cells;
					spectrumLabels = labelSource;
				}
			})
			.catch((cause) => {
				if (workspace === target && spectrumImage === key) {
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
		if (!sent) error = m.ux_connection_unavailable();
		return sent;
	}
	function addNote() {
		const { x, y } = nextNotePosition(camera, notes);
		workspace?.setCamera(revealNote(camera, viewport, { x, y }));
		send('note.create', {
			markdown: `# ${m.v2_new_note_title()}\n\n${m.v2_new_note_body()}`,
			color: '#64748b',
			x,
			y
		});
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
	function closeDiscussion() {
		discussionOpen = false;
		void tick().then(() => {
			if (!discussionOpen)
				document.querySelector<HTMLButtonElement>('[data-testid="discussion-toggle"]')?.focus();
		});
	}
	function selectPending(note: NoteModel) {
		if (!notes.some((value) => value.id === note.id)) return;
		workspace?.setCamera(focusNote(camera, viewport, note));
		void tick().then(() => {
			// The card stays mounted: focusing it neither edits nor discards drafts.
			const card = [...document.querySelectorAll<HTMLElement>('[data-note-id]')].find(
				(element) => element.dataset.noteId === note.id
			);
			card?.focus({ preventScroll: true });
		});
	}
</script>

<svelte:head><title>Spectrum v2 — canvas</title></svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (presentation && event.key === 'Escape') {
			exitPresentation();
			event.preventDefault();
		}
	}}
/>

<div class="v2-shell" class:presentation>
	<header class="v2-topbar">
		<div class="brand">
			<strong>Spectrum</strong><span
				class="connection-pill"
				class:online={status === 'Connected'}
				data-testid="connection-state"
				data-status={status}
				><span class="connection-dot"></span>{status === 'Connected'
					? m.ux_online()
					: m.ux_reconnecting()}</span
			>
		</div>
		{#if room}
			<div class="session-identity">
				<span
					class="role-pill"
					class:admin-role={admin}
					data-testid="own-role"
					data-role={room.role}
					title={room.role === 'admin'
						? m.ux_role_admin_hint()
						: room.role === 'participant'
							? m.ux_role_participant_hint()
							: m.ux_role_spectator_hint()}>{roleLabel(room.role)}</span
				><span class="room-code">{room.roomId}</span>
			</div>
			<nav class="session-controls" aria-label={m.v2_session_controls()}>
				<button
					type="button"
					class="invite-button"
					onclick={() => {
						shareOpen = true;
					}}
					title={m.ux_invite()}><Icon name="link" /><span>{m.ux_invite()}</span></button
				>
				<PeopleMenu {room} {ready} {send} connection={voiceConnection} {speakers} />
				{#key room.roomId}<RoomTimer {room} {ready} {send} />{/key}
				{#if admin && pendingNotes.length}<PendingNotesMenu
						notes={pendingNotes}
						{ready}
						{send}
						select={selectPending}
					/>{/if}
				{#if admin}<RoomOptions {room} {spectrum} {ready} {send} />{/if}
				{#if admin}<LiveMenu state={live} {ready} slices={spectrum?.sliceCount ?? 7} {send} />{/if}
				<AppMenu inRoom bind:presentation />
				<SessionMenu {admin} {ready} {send} />
			</nav>
		{:else}<span class="welcome-privacy">{m.ux_privacy_short()}</span><AppMenu />{/if}
	</header>
	{#if room}<ShareDialog roomId={room.roomId} bind:open={shareOpen} />{/if}
	{#if presentation}<div class="bg-base-100 flex items-center justify-between px-4 py-2 text-xs">
			<span>Spectrum · {room?.roomId}</span><button
				type="button"
				class="btn btn-sm btn-ghost"
				data-testid="presentation-exit"
				onclick={() => {
					exitPresentation();
				}}>{m.leave_streamer()}</button
			>
		</div>{/if}
	{#if room}<div class="v2-actionbar">
			{#if room?.voice?.available}{#key room.roomId}<VoiceMenu
						{room}
						{ready}
						credentials={voiceCredentials}
						failure={voiceFailure}
						{browserSession}
						{browserFailure}
						invalidation={voiceInvalidation}
						bind:connection={voiceConnection}
						bind:speakers
						{send}
					/>{/key}{:else}<span class="audio-unavailable"
					><Icon name="headphones" />{m.ux_audio_unavailable()}</span
				>{/if}
			<div class="content-actions">
				{#key room.roomId}<SocialControls {room} {ready} {reaction} {send} />{/key}
				<button
					type="button"
					class="btn btn-sm btn-outline"
					data-testid="new-note"
					disabled={!ready || room.role === 'spectator'}
					title={room.role === 'spectator' ? m.ux_role_spectator_hint() : m.ux_new_note()}
					onclick={addNote}><Icon name="plus" />{m.ux_new_note()}</button
				><button
					type="button"
					class="btn btn-sm"
					class:btn-active={discussionOpen}
					data-testid="discussion-toggle"
					aria-expanded={discussionOpen}
					aria-controls="room-discussion"
					onclick={() => {
						// Keep the user's world centre and zoom when the sidebar resizes the canvas.
						workspace?.setCamera(camera);
						discussionOpen = !discussionOpen;
					}}
					><Icon name="chat" />{m.ux_discussion_button()}{#if discussionUnread}<span
							class="unread-count"
							data-testid="discussion-unread"
							aria-label={m.ux_discussion_unread({ count: String(discussionUnread) })}
							>{Math.min(99, discussionUnread)}</span
						>{/if}</button
				>
			</div>
		</div>
		{#key room.roomId}<ClaimBar {room} {spectrum} {ready} {send} {presentation} />{/key}{/if}
	{#if error && room}<div role="alert" class="alert alert-error rounded-none py-2">
			{error}
		</div>{/if}
	<div class="workspace-body">
		<main class="canvas-area" data-testid="canvas-viewport" aria-label={m.ux_canvas()}>
			<div bind:this={container} class="canvas-host" class:preview={!room}></div>
			{#if !room}<RoomLobby
					{error}
					connected={status === 'Connected'}
					bind:roomInput
					bind:slices={createSlices}
					bind:neutralCircle={createNeutralCircle}
					bind:topic={createTopic}
					{send}
				/>{/if}
			<div class="pointer-events-none absolute inset-0 overflow-hidden">
				<div class="absolute top-0 left-0 origin-top-left" style:transform={worldTransform}>
					{#if room && spectrum}<SpectrumBoard
							state={presentation ? publicSpectrum(spectrum, room) : spectrum}
							cells={spectrumCells}
							labels={spectrumLabels}
							{room}
							{ready}
							scale={camera.scale}
							{speakers}
							{send}
						/>{/if}
					{#each notes as note (note.id)}
						<NoteCard
							{note}
							drafts={noteDrafts}
							hidden={presentation && !projectedNoteIds.has(note.id)}
							{presentation}
							editable={canEdit(note) && !presentation}
							admin={admin && !presentation}
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
			{#if room}
				<div class="canvas-tools" aria-label={m.ux_canvas_controls()}>
					<IconButton
						icon="minus"
						label={m.v2_zoom_out()}
						disabled={camera.scale <= MIN_SCALE}
						onclick={() => workspace?.zoomBy(1 / 1.2)}
					/><span class="zoom-value">{Math.round(camera.scale * 100)}%</span><IconButton
						icon="plus"
						label={m.v2_zoom_in()}
						disabled={camera.scale >= MAX_SCALE}
						onclick={() => workspace?.zoomBy(1.2)}
					/><span class="tool-separator"></span><IconButton
						icon="frame"
						label={m.v2_reset_view()}
						onclick={() => workspace?.fitToSpectrum()}
					/>
					{#if !presentation}<NoteNavigator {notes} select={selectPending} />{/if}
				</div>
				<div class="canvas-status" role="status" data-testid="canvas-status">
					<span
						>{m.ux_canvas_counts({
							notes: String(notes.length),
							links: String(edges.length)
						})}</span
					><span class="role-help"
						>{room.role === 'admin'
							? m.ux_role_admin_hint()
							: room.role === 'participant'
								? m.ux_role_participant_hint()
								: m.ux_role_spectator_hint()}</span
					>
				</div>
			{/if}
		</main>
		{#if room}{#key room.roomId}<DiscussionPanel
					{room}
					{ready}
					{chat}
					{chatError}
					{activity}
					{transcript}
					{send}
					bind:open={discussionOpen}
					bind:unread={discussionUnread}
					onClose={closeDiscussion}
				/>{/key}{/if}
	</div>
</div>

<style>
	.presentation .v2-topbar,
	.presentation .v2-actionbar,
	.presentation .canvas-tools,
	.presentation .canvas-status {
		display: none;
	}
	.presentation :global(.discussion-panel),
	.presentation :global(.note-tools),
	.presentation :global(.resize-handle),
	.presentation :global(.claim-hint) {
		display: none;
	}
	.presentation .canvas-area {
		pointer-events: none;
	}
	.presentation :global(.canvas-area *) {
		pointer-events: none !important;
	}
	.v2-shell {
		height: 100dvh;
		width: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-base-200);
		color: var(--color-base-content);
	}
	.v2-topbar {
		position: relative;
		z-index: 40;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 18px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--color-base-300);
		background: var(--color-base-100);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.brand strong {
		font-size: 19px;
		letter-spacing: -0.04em;
	}
	.connection-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		opacity: 0.65;
	}
	.connection-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warning);
	}
	.online .connection-dot {
		background: var(--color-success);
	}
	.session-identity {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 10px;
	}
	.role-pill {
		font-size: 10px;
		padding: 3px 8px;
		border: 1px solid var(--color-base-300);
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.role-pill.admin-role {
		color: var(--color-base-content);
		border-color: color-mix(in oklab, var(--color-primary) 35%, transparent);
		background: color-mix(in oklab, var(--color-primary) 8%, transparent);
	}
	.room-code {
		font-size: 11px;
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.session-controls {
		display: flex;
		flex-wrap: wrap;
		max-width: 100%;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}
	.invite-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 36px;
		padding: 0 10px;
		border-radius: 8px;
		font-size: 12px;
	}
	.invite-button:hover {
		background: var(--color-base-200);
	}
	.invite-button:focus-visible {
		outline: 2px solid var(--color-primary);
	}
	.welcome-privacy {
		margin-left: auto;
		font-size: 11px;
		opacity: 0.75;
	}
	.v2-actionbar {
		order: 3;
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		padding: 8px 18px;
		background: var(--color-base-100);
		border-top: 1px solid var(--color-base-300);
	}
	.content-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}
	.unread-count {
		min-width: 18px;
		border-radius: 99px;
		padding: 1px 5px;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-size: 10px;
	}
	.audio-unavailable {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		opacity: 0.5;
	}
	.workspace-body {
		order: 2;
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}
	:global(.v2-shell .claim-bar) {
		order: 1;
	}
	.v2-shell > .alert {
		order: 1;
	}
	.canvas-area {
		position: relative;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		background-image: radial-gradient(
			color-mix(in oklab, var(--color-base-content) 9%, transparent) 1px,
			transparent 1px
		);
		background-size: 24px 24px;
	}
	.canvas-host {
		width: 100%;
		height: 100%;
	}
	.canvas-host.preview {
		opacity: 0.12;
		pointer-events: none;
	}
	.canvas-tools {
		position: absolute;
		z-index: 5;
		left: 16px;
		bottom: 16px;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 5px;
		border: 1px solid var(--color-base-300);
		border-radius: 10px;
		background: var(--color-base-100);
		box-shadow: 0 4px 16px #0001;
	}
	.zoom-value {
		width: 42px;
		text-align: center;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.tool-separator {
		height: 20px;
		width: 1px;
		margin-inline: 4px;
		background: var(--color-base-300);
	}
	.canvas-status {
		position: absolute;
		pointer-events: none;
		right: 16px;
		bottom: 16px;
		display: flex;
		flex-direction: column;
		align-items: end;
		gap: 4px;
		max-width: min(44%, 30rem);
		font-size: 10px;
	}
	.canvas-status > span {
		padding: 4px 8px;
		background: color-mix(in oklab, var(--color-base-100) 90%, transparent);
		border-radius: 5px;
	}
	.role-help {
		opacity: 0.65;
	}
	:global(.v2-shell .toolbar-summary) {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-width: 36px;
		min-height: 36px;
		padding: 6px;
		border-radius: 8px;
		cursor: pointer;
		list-style: none;
	}
	:global(.v2-shell .toolbar-summary::-webkit-details-marker) {
		display: none;
	}
	:global(.v2-shell .toolbar-summary:hover) {
		background: var(--color-base-200);
	}
	:global(.v2-shell .toolbar-summary:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	:global(.v2-shell .toolbar-popover) {
		position: absolute;
		z-index: 50;
		top: calc(100% + 8px);
		right: 0;
		max-height: min(75dvh, 44rem);
		border-color: var(--color-base-300);
	}
	.v2-actionbar :global(.toolbar-popover) {
		top: auto;
		bottom: calc(100% + 8px);
	}
	:global(.v2-topbar .icon-button),
	:global(.v2-actionbar .icon-button),
	:global(.canvas-tools .icon-button) {
		min-width: 34px;
		min-height: 34px;
	}
	@media (max-width: 639px) {
		.v2-topbar {
			flex-wrap: wrap;
			gap: 6px 12px;
			padding: 8px 12px;
		}
		.brand {
			flex: 1;
			gap: 8px;
		}
		.brand strong {
			font-size: 18px;
		}
		.session-identity {
			order: 3;
			flex-basis: 100%;
			gap: 8px;
		}
		.v2-actionbar {
			padding: 8px 12px;
			gap: 8px;
		}
		.content-actions {
			width: 100%;
			justify-content: flex-end;
		}
		.invite-button span,
		.welcome-privacy,
		.role-help {
			display: none;
		}
		.invite-button {
			min-width: 36px;
			padding: 0;
		}
		.canvas-tools {
			left: 10px;
			bottom: 10px;
		}
		.canvas-status {
			right: 10px;
			top: 10px;
			bottom: auto;
		}
		:global(.v2-shell .toolbar-popover) {
			position: fixed;
			top: auto;
			inset-inline: 12px;
			bottom: 12px;
			width: auto;
			max-height: 75dvh;
		}
		.v2-actionbar :global(.toolbar-popover) {
			bottom: 12px;
		}
	}
</style>
