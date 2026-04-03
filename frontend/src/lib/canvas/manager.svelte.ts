import { Canvas, loadSVGFromURL, util } from 'fabric';
import { lerp, pointInPolygon } from '$lib/utils';
import { room, removeParticipant } from '$lib/spectrum/room.svelte';
import { newPellet } from '$lib/canvas/pellet';
import { m } from '$lib/paraglide/messages.js';

export const originalWidth = 980;
export const originalHeight = 735;
const UPDATE_TICK = 100;

type Pellet = ReturnType<typeof newPellet>;
type Coords = { x: number; y: number };
type LogFn = (message: string, type?: string) => void;

function getOpinionLabel(id: string): string {
	switch (id) {
		case 'stronglyAgree':
			return m.opinion_strongly_agree();
		case 'agree':
			return m.opinion_agree();
		case 'slightlyAgree':
			return m.opinion_slightly_agree();
		case 'neutral':
			return m.opinion_neutral();
		case 'slightlyDisagree':
			return m.opinion_slightly_disagree();
		case 'disagree':
			return m.opinion_disagree();
		case 'stronglyDisagree':
			return m.opinion_strongly_disagree();
		case 'indifferent':
			return m.opinion_indifferent();
		default:
			return id;
	}
}

class CanvasManager {
	myPellet: Pellet | null = $state(null);

	private _canvas: Canvas | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _svg: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _cells: any[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _cellsPoints: any[][] = [];
	private _scale = 1;
	private _canvasWidth = originalWidth;
	private _moving = false;
	private _currentOpinion = 'notReplied';
	private _previousOpinion = 'notReplied';
	private _showNeutralCircle = true;
	private _updateIntervalId: ReturnType<typeof setInterval> | null = null;
	private _rafId: number | null = null;

	private _log(message: string, type?: string) {
		const now = new Date();
		const formattedDate = now.toLocaleString('fr-FR');
		room.logs.push({ message: `[${formattedDate}] ${message}`, type: type ?? 'message' });
	}

	get isMoving() {
		return this._moving;
	}

	stopMoving() {
		this._moving = false;
	}

	setNeutralCircleVisible(show: boolean) {
		this._showNeutralCircle = show;
		for (const cell of this._cells) {
			if (cell.id === 'notReplied' || cell.id === 'indifferent') {
				cell.set({ opacity: show ? 1 : 0 });
			}
		}
		this._canvas?.requestRenderAll();
	}

	// ---------------------------------------------------------------------------
	// Canvas setup
	// ---------------------------------------------------------------------------

	drawCanvas(id: string): Canvas {
		const canvas = new Canvas(id);
		canvas.hoverCursor = 'pointer';
		canvas.selection = false;
		canvas.targetFindTolerance = 2;
		canvas.backgroundColor = 'white';

		const canvasHeight = (this._canvasWidth * 600) / 800;
		canvas.setDimensions({ width: this._canvasWidth, height: canvasHeight });

		canvas.on({
			'object:moving': () => {
				this._moving = true;
			},
			'object:modified': () => {
				this._moving = false;
				if (
					this._currentOpinion !== 'notReplied' &&
					this._currentOpinion !== this._previousOpinion
				) {
					this._log(
						m.log_your_opinion({ opinion: getOpinionLabel(this._currentOpinion) }),
						'event'
					);
					this._previousOpinion = this._currentOpinion;
				}
			}
		});

		this._canvas = canvas;
		return canvas;
	}

	async loadSVG() {
		let objects: unknown[], options: unknown;
		try {
			({ objects, options } = await loadSVGFromURL(m.file_spectrum()));
		} catch (err) {
			console.error('Failed to load SVG:', err);
			return;
		}
		// @ts-expect-error -- groupSVGElements return type not fully typed
		const svg = util.groupSVGElements(objects, options);

		const canvasWidth = this._canvas!.getWidth();
		const canvasHeight = this._canvas!.getHeight();
		const scaleX = canvasWidth / svg.width!;
		const scaleY = canvasHeight / svg.height!;
		const scale = Math.min(scaleX, scaleY);

		svg.set({
			originX: 'left',
			originY: 'top',
			scaleX: scale,
			scaleY: scale,
			left: (canvasWidth - svg.width! * scale) / 2,
			top: 15 * this._scale
		});
		svg.selectable = false;
		svg.evented = false;

		for (let i = 0; i <= 8; i++) {
			this._cells.push(objects[i]);
			const cell = this._cells[this._cells.length - 1];
			this._cellsPoints[this._cells.length - 1] = [];

			for (let index = 0; index < cell.path.length - 2; index++) {
				const pathPoint = cell.path[index];
				const p = [
					pathPoint[pathPoint.length - 2] * scale - 15 * scale,
					pathPoint[pathPoint.length - 1] * scale - 10 * scale
				];
				this._cellsPoints[this._cells.length - 1].push(p);
			}
		}

		this._svg = svg;
		this._canvas!.add(svg);
		this._canvas!.sendObjectToBack(svg);
	}

	/** Called whenever canvasWidth changes — rescales SVG, pellets and recomputes cell points. */
	setScale(scale: number, canvasWidth: number) {
		this._scale = scale;
		this._canvasWidth = canvasWidth;

		if (!this._canvas) return;

		this._canvas.setDimensions({ width: canvasWidth, height: scale * originalHeight });

		if (this._svg) {
			this._svg.set({
				originX: 'left',
				originY: 'top',
				scaleX: scale,
				scaleY: scale,
				left: (canvasWidth - this._svg.width! * scale) / 2,
				top: 15 * scale
			});
		}

		this.myPellet?.set({ scaleX: scale, scaleY: scale });

		Object.keys(room.others).forEach((key) => {
			if (room.others[key].pellet) {
				room.others[key].pellet.set({ scaleX: scale, scaleY: scale });
			}
		});

		this._canvas.requestRenderAll();

		for (let i = 0; i < this._cells.length; i++) {
			const cell = this._cells[i];
			this._cellsPoints[i] = [];

			for (let index = 0; index < cell.path.length - 2; index++) {
				const pathPoint = cell.path[index];
				const p = [
					pathPoint[pathPoint.length - 2] * scale - 15 * scale,
					pathPoint[pathPoint.length - 1] * scale - 10 * scale
				];
				this._cellsPoints[i].push(p);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Local pellet
	// ---------------------------------------------------------------------------

	/**
	 * Creates the local user's pellet and starts the position-broadcast interval.
	 * `onUpdate` is called every UPDATE_TICK ms — it should send `myposition` over the WS.
	 */
	initMyPellet(onUpdate: () => void): boolean {
		console.log('Initializing Your Pellet');
		if (!room.userId) return false;
		this._currentOpinion = 'notReplied';
		this._previousOpinion = 'notReplied';
		if (!room.nickname) room.nickname = 'Participant ' + (Math.floor(Math.random() * 100) + 1);

		const pellet = newPellet(room.userId, room.nickname);
		pellet.set({
			top: (this._canvasWidth * originalHeight) / originalWidth / 2,
			left: this._canvasWidth / 2,
			scaleX: this._scale,
			scaleY: this._scale,
			evented: true
		});

		this._canvas!.add(pellet);
		this.myPellet = pellet;

		// Highlight cells while dragging and track current opinion
		this._canvas!.on({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			'object:moving': ({ target }: { target: any }) => {
				if (target !== this.myPellet) return;

				for (let i = 0; i < this._cells.length; i++) {
					const cell = this._cells[i];
					const isNeutralCell = cell.id === 'notReplied' || cell.id === 'indifferent';
					if (!this._showNeutralCircle && isNeutralCell) continue;
					if (pointInPolygon(this._cellsPoints[i], [this.myPellet!.left, this.myPellet!.top])) {
						cell.set({ fill: '#10b1b1' });
						if (cell.id !== this._currentOpinion) {
							this._currentOpinion = cell.id;
						}
					} else {
						if (isNeutralCell) {
							cell.set({ fill: '#ccc' });
						} else {
							cell.set({ fill: '#000002' });
						}
					}
				}
			}
		});

		if (this._updateIntervalId !== null) clearInterval(this._updateIntervalId);
		this._updateIntervalId = setInterval(onUpdate, UPDATE_TICK);

		return true;
	}

	removeMyPellet() {
		if (this._updateIntervalId !== null) {
			clearInterval(this._updateIntervalId);
			this._updateIntervalId = null;
		}
		if (this.myPellet) {
			this._canvas?.remove(this.myPellet);
			this._canvas?.renderAll();
			this.myPellet = null;
		}
	}

	setMyPelletPosition(x: number, y: number) {
		if (!this.myPellet) return;
		this.myPellet.left = x * this._scale;
		this.myPellet.top = y * this._scale;
		this.myPellet.setCoords();
		this._canvas?.renderAll();
	}

	getMyPelletCoords(): { x: number; y: number } | null {
		if (!this.myPellet) return null;
		return {
			x: Math.round(this.myPellet.left / this._scale),
			y: Math.round(this.myPellet.top / this._scale)
		};
	}

	// ---------------------------------------------------------------------------
	// Other participants' pellets
	// ---------------------------------------------------------------------------

	initOtherPellet(userId: string, nickname: string, logFn?: LogFn): Pellet {
		console.log('Initializing Other Pellet: ' + userId);
		if (logFn) logFn(m.log_joined_spectrum({ name: nickname }), 'join');
		else this._log(m.log_joined_spectrum({ name: nickname }), 'join');

		const pellet = newPellet(userId, nickname);
		pellet.set({
			top: (this._canvasWidth * originalHeight) / originalWidth / 2,
			left: this._canvasWidth / 2
		});
		this._canvas!.add(pellet);
		return pellet;
	}

	updatePellet(otherUserId: string, coords: Coords | null, otherNickname: string) {
		if (!room.others[otherUserId]) {
			room.others[otherUserId] = {
				pellet:
					coords && !isNaN(coords.x) && !isNaN(coords.y)
						? this.initOtherPellet(otherUserId, otherNickname)
						: null,
				target: coords && !isNaN(coords.x) && !isNaN(coords.y) ? coords : undefined,
				nickname: otherNickname,
				microphone: false,
				volume: 100,
				handRaised: false
			};
		} else if (coords && !isNaN(coords.x) && !isNaN(coords.y)) {
			room.others[otherUserId].target = coords;
			if (room.others[otherUserId].nickname !== otherNickname)
				room.others[otherUserId].nickname = otherNickname;
			if (!room.others[otherUserId].pellet)
				room.others[otherUserId].pellet = this.initOtherPellet(otherUserId, otherNickname);
		}

		if (coords && (!isNaN(coords.x) || !isNaN(coords.y))) {
			if (room.others[otherUserId].validateOpinion)
				clearTimeout(room.others[otherUserId].validateOpinion);

			room.others[otherUserId].validateOpinion = setTimeout(() => {
				this.validateOpinion(otherUserId);
			}, 500);
		}
	}

	deletePellet(otherUserId: string, keepUser = false) {
		if (room.others[otherUserId]?.pellet) {
			this._canvas!.remove(room.others[otherUserId].pellet);
			this._canvas!.renderAll();
			room.others[otherUserId].pellet = null;
		}
		if (!keepUser) {
			removeParticipant(otherUserId);
		}
	}

	validateOpinion(otherUserId: string, logFn?: LogFn) {
		const target = room.others[otherUserId]?.pellet;
		if (!target) return;

		const log = logFn ?? this._log.bind(this);

		for (let i = 0; i < this._cells.length; i++) {
			const cell = this._cells[i];
			const isNeutralCell = cell.id === 'notReplied' || cell.id === 'indifferent';
			if (!this._showNeutralCircle && isNeutralCell) continue;
			if (pointInPolygon(this._cellsPoints[i], [target.left, target.top])) {
				if (cell.id !== 'notReplied') {
					log(
						m.log_opinion({
							name: room.others[otherUserId].nickname,
							opinion: getOpinionLabel(cell.id)
						}),
						'event'
					);
				}
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Animation
	// ---------------------------------------------------------------------------

	animatePellets() {
		const t = 0.2;
		for (const uid of Object.keys(room.others)) {
			const pellet = room.others[uid].pellet;
			const target = room.others[uid].target;
			if (!pellet || !target) continue;
			pellet.set({
				left: lerp(pellet.left ?? 0, target.x * this._scale, t),
				top: lerp(pellet.top ?? 0, target.y * this._scale, t)
			});
		}
		this._canvas!.requestRenderAll();
		this._rafId = requestAnimationFrame(() => this.animatePellets());
	}

	stopAnimating() {
		if (this._rafId !== null) cancelAnimationFrame(this._rafId);
		this._rafId = null;
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	/** Remove all pellets from the canvas (call before leaveRoom). */
	clearAllPellets() {
		this.stopAnimating();
		if (this._updateIntervalId !== null) {
			clearInterval(this._updateIntervalId);
			this._updateIntervalId = null;
		}
		this.removeMyPellet();
		for (const key in room.others) {
			if (room.others[key].pellet) {
				this._canvas?.remove(room.others[key].pellet);
				room.others[key].pellet = null;
			}
		}
		this._canvas?.renderAll();
	}

	/** Reset all state — call in onDestroy to avoid accumulation across SvelteKit navigations. */
	reset() {
		if (this._canvas) {
			this.clearAllPellets();
			this.removeMyPellet();
		}
		this.stopAnimating();
		if (this._updateIntervalId !== null) {
			clearInterval(this._updateIntervalId);
			this._updateIntervalId = null;
		}
		this._cells = [];
		this._cellsPoints = [];
		this._svg = null;
		this._canvas?.dispose();
		this._canvas = null;
		this._currentOpinion = 'notReplied';
		this._previousOpinion = 'notReplied';
		this._showNeutralCircle = true;
		this.myPellet = null;
	}
}

export const canvasManager = new CanvasManager();
