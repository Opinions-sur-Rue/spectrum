/**
 * Konva workspace of a v2 room: the spectrum zone, notes and typed edges on a
 * bounded infinite canvas.
 *
 * The class is created through `CanvasWorkspace.create` because Konva is
 * loaded with a dynamic import: the module stays importable during SSR and in
 * Node tests, where `window` does not exist.
 */
import type Konva from 'konva';
import {
	SPECTRUM_HEIGHT,
	SPECTRUM_WIDTH,
	clampCamera,
	createCamera,
	fitSpectrum,
	panBy,
	zoomAt,
	type Camera,
	type Point,
	type Viewport
} from './camera';
import { createEdgeLine } from './edge-node';
import type { EdgeModel, NoteModel } from './models';
import { createNoteGroup } from './note-node';

export type { EdgeModel, Moderation, NoteModel, Relation } from './models';

type KonvaNamespace = typeof import('konva').default;

export class CanvasWorkspace {
	private readonly container: HTMLDivElement;
	private readonly konva: KonvaNamespace;
	private readonly stage: Konva.Stage;
	private readonly spectrumLayer: Konva.Layer;
	private readonly edgeLayer: Konva.Layer;
	private readonly noteLayer: Konva.Layer;
	private readonly resizeObserver: ResizeObserver;

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- renderer state, never read in a template
	private notes = new Map<string, NoteModel>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- renderer state, never read in a template
	private edges = new Map<string, EdgeModel>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Konva nodes, never read in a template
	private noteGroups = new Map<string, Konva.Group>();
	private cameraState: Camera = createCamera();

	private panning = false;
	private lastPointer: Point | null = null;

	private noteMovedCallback: ((id: string, x: number, y: number) => void) | null = null;
	private noteSelectedCallback: ((id: string | null) => void) | null = null;
	private canMoveNote: (note: NoteModel) => boolean = () => true;
	private viewChangedCallback: ((camera: Camera, viewport: Viewport) => void) | null = null;
	private imageGeneration = 0;
	private destroyed = false;
	private followSpectrumFit = true;
	private visibleNoteIds: ReadonlySet<string> | null = null;

	/** Filter projected edges without replacing note models or mounted HTML editors. */
	setVisibleNoteIds(ids: ReadonlySet<string> | null): void {
		this.visibleNoteIds = ids;
		this.refreshEdges();
	}

	private constructor(container: HTMLDivElement, konva: KonvaNamespace) {
		this.container = container;
		this.konva = konva;

		const viewport = this.viewport();

		this.stage = new konva.Stage({
			container,
			width: viewport.width,
			height: viewport.height
		});

		this.spectrumLayer = new konva.Layer({ listening: false });
		this.edgeLayer = new konva.Layer({ listening: false });
		this.noteLayer = new konva.Layer();

		this.stage.add(this.spectrumLayer);
		this.stage.add(this.edgeLayer);
		this.stage.add(this.noteLayer);

		this.drawSpectrumZone();
		this.bindStageEvents();

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(container);

		this.fitToSpectrum();
	}

	/** Loads Konva and builds the workspace. Call from `onMount` only. */
	static async create(container: HTMLDivElement): Promise<CanvasWorkspace> {
		const konva = (await import('konva')).default;
		return new CanvasWorkspace(container, konva);
	}

	get camera(): Camera {
		return { ...this.cameraState };
	}

	setCamera(camera: Camera): void {
		this.followSpectrumFit = false;
		this.cameraState = clampCamera(camera, this.viewport());
		this.applyCamera();
	}

	fitToSpectrum(): void {
		this.setCamera(fitSpectrum(this.viewport()));
		this.followSpectrumFit = true;
	}

	/** Zooms around the viewport centre, for the toolbar buttons. */
	zoomBy(factor: number): void {
		const viewport = this.viewport();
		const centre = { x: viewport.width / 2, y: viewport.height / 2 };
		this.setCamera(zoomAt(this.cameraState, viewport, centre, this.cameraState.scale * factor));
	}

	onNoteMoved(callback: (id: string, x: number, y: number) => void): void {
		this.noteMovedCallback = callback;
	}

	onNoteSelected(callback: (id: string | null) => void): void {
		this.noteSelectedCallback = callback;
	}

	setMovePermission(callback: (note: NoteModel) => boolean): void {
		this.canMoveNote = callback;
		for (const [id, group] of this.noteGroups) {
			const note = this.notes.get(id);
			if (note) group.draggable(callback(note));
		}
	}

	/** HTML note cards share exactly the same world transform as Konva edges. */
	onViewChanged(callback: (camera: Camera, viewport: Viewport) => void): void {
		this.viewChangedCallback = callback;
		callback(this.camera, this.viewport());
	}

	useHTMLNotes(): void {
		this.noteLayer.visible(false);
	}

	async setSpectrumImage(source: string): Promise<void> {
		const generation = ++this.imageGeneration;
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not load spectrum image'));
			image.src = source;
		});
		if (this.destroyed || generation !== this.imageGeneration) return;
		this.spectrumLayer.destroyChildren();
		this.spectrumLayer.add(
			new this.konva.Image({
				image,
				x: -SPECTRUM_WIDTH / 2,
				y: -SPECTRUM_HEIGHT / 2,
				width: SPECTRUM_WIDTH,
				height: SPECTRUM_HEIGHT
			})
		);
		this.spectrumLayer.batchDraw();
	}

	previewNoteMove(id: string, x: number, y: number): void {
		const note = this.notes.get(id);
		if (!note) return;
		this.notes.set(id, { ...note, x, y });
		this.refreshEdges();
	}

	previewNoteResize(id: string, width: number, height: number): void {
		const note = this.notes.get(id);
		if (!note) return;
		this.notes.set(id, { ...note, width, height });
		this.refreshEdges();
	}

	setNotes(notes: NoteModel[]): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- renderer state, never read in a template
		this.notes = new Map(notes.map((note) => [note.id, note]));
		this.rebuildNotes();
		this.refreshEdges();
	}

	upsertNote(note: NoteModel): void {
		this.notes.set(note.id, note);
		const existing = this.noteGroups.get(note.id);
		if (existing) {
			existing.destroy();
			this.noteGroups.delete(note.id);
		}
		this.addNoteGroup(note);
		this.refreshEdges();
	}

	removeNote(id: string): void {
		this.notes.delete(id);
		this.noteGroups.get(id)?.destroy();
		this.noteGroups.delete(id);
		this.refreshEdges();
	}

	setEdges(edges: EdgeModel[]): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- renderer state, never read in a template
		this.edges = new Map(edges.map((edge) => [edge.id, edge]));
		this.refreshEdges();
	}

	upsertEdge(edge: EdgeModel): void {
		this.edges.set(edge.id, edge);
		this.refreshEdges();
	}

	removeEdge(id: string): void {
		this.edges.delete(id);
		this.refreshEdges();
	}

	destroy(): void {
		this.destroyed = true;
		this.resizeObserver.disconnect();
		this.stage.destroy();
		this.noteGroups.clear();
		this.notes.clear();
		this.edges.clear();
	}

	// --- Internals ---

	private viewport(): Viewport {
		return {
			width: this.container.clientWidth,
			height: this.container.clientHeight
		};
	}

	private applyCamera(): void {
		const viewport = this.viewport();
		const camera = this.cameraState;

		this.stage.scale({ x: camera.scale, y: camera.scale });
		this.stage.position({
			x: viewport.width / 2 - camera.x * camera.scale,
			y: viewport.height / 2 - camera.y * camera.scale
		});
		this.stage.batchDraw();
		this.viewChangedCallback?.(this.camera, viewport);
	}

	private handleResize(): void {
		const viewport = this.viewport();
		this.stage.width(viewport.width);
		this.stage.height(viewport.height);
		if (this.followSpectrumFit) this.fitToSpectrum();
		else this.setCamera(this.cameraState);
	}

	private drawSpectrumZone(): void {
		this.spectrumLayer.destroyChildren();

		this.spectrumLayer.add(
			new this.konva.Rect({
				name: 'spectrum-zone',
				x: -SPECTRUM_WIDTH / 2,
				y: -SPECTRUM_HEIGHT / 2,
				width: SPECTRUM_WIDTH,
				height: SPECTRUM_HEIGHT,
				cornerRadius: 18,
				fill: 'rgba(148, 163, 184, 0.10)',
				stroke: '#94a3b8',
				strokeWidth: 2,
				dash: [10, 6]
			})
		);

		this.spectrumLayer.add(
			new this.konva.Text({
				x: -SPECTRUM_WIDTH / 2,
				y: -SPECTRUM_HEIGHT / 2 - 34,
				width: SPECTRUM_WIDTH,
				text: 'Spectrum',
				fontSize: 20,
				fontStyle: 'bold',
				fontFamily: 'system-ui, sans-serif',
				fill: '#94a3b8',
				align: 'center'
			})
		);

		this.spectrumLayer.batchDraw();
	}

	private bindStageEvents(): void {
		this.stage.on('wheel', (event) => {
			event.evt.preventDefault();

			const pointer = this.stage.getPointerPosition();
			if (!pointer) return;

			const factor = event.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
			this.setCamera(
				zoomAt(this.cameraState, this.viewport(), pointer, this.cameraState.scale * factor)
			);
		});

		this.stage.on('pointerdown', (event) => {
			const target = event.target;
			const onBackground = target === this.stage || target.name() === 'spectrum-zone';
			const middleButton = event.evt.button === 1;

			if (!onBackground && !middleButton) return;

			this.panning = true;
			this.lastPointer = this.stage.getPointerPosition();
			this.container.style.cursor = 'grabbing';
		});

		this.stage.on('pointermove', () => {
			if (!this.panning || !this.lastPointer) return;

			const pointer = this.stage.getPointerPosition();
			if (!pointer) return;

			const dx = pointer.x - this.lastPointer.x;
			const dy = pointer.y - this.lastPointer.y;
			this.lastPointer = pointer;

			this.setCamera(panBy(this.cameraState, this.viewport(), dx, dy));
		});

		const stopPanning = () => {
			if (!this.panning) return;
			this.panning = false;
			this.lastPointer = null;
			this.container.style.cursor = '';
		};

		this.stage.on('pointerup pointercancel', stopPanning);
		this.stage.on('click tap', (event) => {
			if (event.target === this.stage) this.noteSelectedCallback?.(null);
		});
	}

	private rebuildNotes(): void {
		this.noteLayer.destroyChildren();
		this.noteGroups.clear();

		for (const note of this.notes.values()) {
			this.addNoteGroup(note);
		}

		this.noteLayer.batchDraw();
	}

	private addNoteGroup(note: NoteModel): void {
		const group = createNoteGroup(note);
		group.draggable(this.canMoveNote(note));

		group.on('dragmove', () => {
			const model = this.notes.get(note.id);
			if (!model) return;
			model.x = group.x();
			model.y = group.y();
			this.refreshEdges();
		});

		group.on('dragend', () => {
			this.noteMovedCallback?.(note.id, group.x(), group.y());
		});

		group.on('click tap', (event) => {
			event.cancelBubble = true;
			this.noteSelectedCallback?.(note.id);
		});

		this.noteGroups.set(note.id, group);
		this.noteLayer.add(group);
		this.noteLayer.batchDraw();
	}

	private refreshEdges(): void {
		this.edgeLayer.destroyChildren();

		for (const edge of this.edges.values()) {
			if (
				this.visibleNoteIds &&
				(!this.visibleNoteIds.has(edge.from) || !this.visibleNoteIds.has(edge.to))
			)
				continue;
			const from = this.notes.get(edge.from);
			const to = this.notes.get(edge.to);
			if (!from || !to) continue;

			this.edgeLayer.add(
				createEdgeLine(
					edge,
					{ x: from.x + from.width / 2, y: from.y + from.height / 2 },
					{ x: to.x + to.width / 2, y: to.y + to.height / 2 }
				)
			);
		}

		this.edgeLayer.batchDraw();
	}
}
