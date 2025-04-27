<script lang="ts">
	/* eslint-disable */
	// @ts-nocheck
	/* eslint svelte/no-at-html-tags: "off" */

	import Header from '$lib/components/Header.svelte';
	import { notifier } from '$lib/notifications';
	import Fa from 'svelte-fa';
	import {
		faRotateLeft,
		faCirclePlus,
		faStop,
		faCopy,
		faPersonWalkingArrowRight,
		faPerson,
		faExclamation,
		faPalette,
		faNewspaper,
		faUserSlash
	} from '@fortawesome/free-solid-svg-icons';

	import { startWebsocket } from '$lib/spectrum/websocket';
	import { getUserId } from '$lib/authentication/userId';
	import { onMount, tick } from 'svelte';
	import { copy } from 'svelte-copy';

	import { page } from '$app/state';
	import { HEADER_TITLE, LOGO_URL, LOGO_WIDTH, OFFSET_SUBSTITLE, PUBLIC_URL } from '$lib/env';
	import { Circle, Rect, FabricText, Group, util, Canvas, loadSVGFromURL } from 'fabric';

	const palette: object = {
		aeaeae: 'Gris  ', // Neutral gray
		cd5334: 'Brun  ', // Burnt orange
		ff5555: 'Rouge ', // Bright red
		ff9955: 'Orange', // Vibrant orange
		ffe680: 'Jaune ', // Soft yellow
		aade87: 'Vert  ', // Light green
		aaeeff: 'Bleu  ', // Light cyan
		'4b0082': 'Indigo', // Indigo
		c6afe9: 'Violet', // Soft lavender
		d473d4: 'Mauve ' // Muted mauve
	};

	const opinions = {
		stronglyAgree: "Complètement d'accord",
		agree: "D'accord",
		slightlyAgree: "Un peu d'accord",
		neutral: 'Neutre',
		slightlyDisagree: 'Un peu en désaccord',
		disagree: 'En désaccord',
		stronglyDisagree: 'Complètement en désaccord',
		indifferent: 'Indifférent ou sans avis',
		notReplied: 'Pas répondu encore'
	};
	let currentOpinion: string = 'notReplied';
	let previousOpinion: string = 'notReplied';

	export let spectrumId: string | undefined;

	let canvasWidth: number | undefined;

	let myCanvas: Canvas;

	const updateTick: number = 100;

	let websocket: WebSocket;
	//let connected = false;

	let userId: string;
	let nickname: string;
	let initialized = false;
	let listenning = true;

	let logs: string[] = [];

	let myPellet: any;
	let moving = false;
	const cells: any[] = [];
	const cellsPoints: any[] = [];
	const others: any = {};

	let claim: string | undefined;
	let scale: number;

	let tbodyRef: any; // Reference to tbody

	function validateOpinion(otherUserId: string) {
		const target = others[otherUserId].pellet;

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];

			if (pointInPolygon(cellsPoints[i], [target.left, target.top])) {
				if (cell.id != 'notReplied') {
					log(`${others[otherUserId].nickname} est "${opinions[cell.id]}"`);
				}
			}
		}
	}

	$: {
		scale = canvasWidth / 980;
	}

	async function scrollToBottom() {
		await tick(); // Wait for UI to update
		if (tbodyRef && !isHoveringHistory) {
			tbodyRef.scrollTop = tbodyRef.scrollHeight;
		}
	}

	onMount(() => {
		currentOpinion = 'notReplied';

		spectrumId = page.params?.id;
		websocket = startWebsocket(signIn, parseCommand, connectionLost);

		// Prepare Both Canvas
		myCanvas = drawCanvas('spectrum');

		myCanvas.on({
			'object:moving': function () {
				// /** @type {{ target: { width?: any; angle: any; left?: any; top?: any; }; }} */ e
				moving = true;
				//websocket.send(`update ${userId} ${e.target.left},${e.target.top}`);
			},
			'object:modified': function () {
				// /** @type {{ target: { left?: any; width?: any; top?: any; setCoords?: any; angle?: number; }; }} */ e
				moving = false;

				if (currentOpinion != 'notReplied' && currentOpinion != previousOpinion) {
					log(`Vous êtes "${opinions[currentOpinion]}"`);
					previousOpinion = currentOpinion;
				}
			}
		});

		// @ts-ignore
		loadSVGFromURL('/spectrum.svg').then(({ objects, options }) => {
			// @ts-ignore
			const svg = util.groupSVGElements(objects, options);

			// Get canvas dimensions
			const canvasWidth = myCanvas.getWidth();
			const canvasHeight = myCanvas.getHeight();

			// Calculate scaling factors
			const scaleX = canvasWidth / svg.width!;
			const scaleY = canvasHeight / svg.height!;
			const scale = Math.min(scaleX, scaleY); // Maintain aspect ratio

			svg.set({
				scaleX: scale,
				scaleY: scale,
				left: (canvasWidth - svg.width! * scale) / 2,
				top: 15
			});

			svg.selectable = false;
			svg.evented = false;

			for (let i = 0; i <= 8; i++) {
				cells.push(objects[i]);
				const cell = cells[cells.length - 1];
				cellsPoints[cells.length - 1] = [];

				for (let index = 0; index < cell.path.length - 2; index++) {
					let pathPoint = cell.path[index];

					let p = [
						pathPoint[pathPoint.length - 2] * cell.scaleX * scale - 15,
						pathPoint[pathPoint.length - 1] * cell.scaleY * scale - 10
					];

					/*const circle = new fabric.Circle({
							radius: 20,           // Radius of the circle (small size)
							fill: 'blue',         // Fill color of the circle
							left: p[0],            // X position of the circle (left)
							top: p[1],             // Y position of the circle (top)
						});
						myCanvas.add(circle)*/
					cellsPoints[cells.length - 1].push(p);
				}
			}

			myCanvas.add(svg);
			myCanvas.sendObjectToBack(svg);
		});

		// We're joining a spectrum
		if (spectrumId) {
			toggleJoinModal();
		}

		animateCursors();
	});

	function initPellet() {
		console.log('Initalizing Your Pellet');
		var options = {
			top: 0,
			left: 0
		};

		// @ts-ignore
		options.radius = 12;

		// only if not assigned, then random
		if (!userId)
			userId = Object.keys(palette)[util.getRandomInt(0, Object.keys(palette).length - 1)];

		let circle = new Circle({
			...options,
			fill: `#${userId}`,
			stroke: '#f9f9f9',
			strokeWidth: 3,
			strokeUniform: true,
			hasBorders: false,
			hasContext: false
		});

		let text = new FabricText(nickname, {
			fontFamily: 'monospace',
			left: circle.left + circle.radius + 20,
			top: circle.top - circle.radius - 11,
			fontSize: 14,
			color: '#f9f9f9',
			hasBorders: false,
			hasContext: false,
			opacity: 0.5
		});

		let rect = new Rect({
			left: circle.left + circle.radius + 13,
			top: circle.top - circle.radius - 18,
			width: text.width + 10,
			height: text.height + 10,
			fill: `#${userId}`,
			stroke: '#f9f9f9',
			strokeWidth: 3,
			strokeUniform: true,
			hasBorders: false,
			hasContext: false,
			opacity: 0.5
		});

		let g = new Group([circle, rect, text], {
			top: (canvasWidth * 735) / 980 / 2,
			left: canvasWidth / 2,
			hasBorders: false,
			hasControls: false
		});

		g.on({
			mouseover: () => {
				rect.set({ opacity: 1 });
				text.set({ opacity: 1 });
				myCanvas.renderAll();
			},
			mouseout: () => {
				rect.set({ opacity: 0.5 });
				text.set({ opacity: 0.5 });
				myCanvas.renderAll();
			}
		});

		myCanvas.add(g);
		myPellet = g;

		myCanvas.on({
			'object:moving': function ({ target }) {
				if (target != myPellet) return;

				for (let i = 0; i < cells.length; i++) {
					const cell = cells[i];

					if (pointInPolygon(cellsPoints[i], [myPellet.left, myPellet.top])) {
						cell.set({ fill: '#10b1b1' });
						console.log(cell.id);
						if (cell.id != currentOpinion) {
							currentOpinion = cell.id;
						}
					} else {
						if (cell.id == 'notReplied' || cell.id == 'indifferent') {
							cell.set({ fill: '#ccc' });
						} else {
							cell.set({ fill: '#000002' });
						}
					}
				}
			}
		});

		setInterval(updateMyPellet, updateTick);
	}

	/**
	 * Performs the even-odd-rule Algorithm (a raycasting algorithm) to find out whether a point is in a given polygon.
	 * This runs in O(n) where n is the number of edges of the polygon.
	 *
	 * @param {Array} polygon an array representation of the polygon where polygon[i][0] is the x Value of the i-th point and polygon[i][1] is the y Value.
	 * @param {Array} point   an array representation of the point where point[0] is its x Value and point[1] is its y Value
	 * @return {boolean} whether the point is in the polygon (not on the edge, just turn < into <= and > into >= for that)
	 */
	const pointInPolygon = function (polygon: any, point: any) {
		//A point is in a polygon if a line from the point to infinity crosses the polygon an odd number of times
		let odd = false;
		//For each edge (In this case for each point of the polygon and the previous one)
		for (let i = 0, j = polygon.length - 1; i < polygon.length; i++) {
			//If a line from the point into infinity crosses this edge
			if (
				polygon[i][1] > point[1] !== polygon[j][1] > point[1] && // One point needs to be above, one below our y coordinate
				// ...and the edge doesn't cross our Y corrdinate before our x coordinate (but between our x coordinate and infinity)
				point[0] <
					((polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1])) /
						(polygon[j][1] - polygon[i][1]) +
						polygon[i][0]
			) {
				// Invert odd
				odd = !odd;
			}
			j = i;
		}
		//If the number of crossings was odd, the point is in the polygon
		return odd;
	};

	/**
	 * @param {string} userId
	 */
	function initOtherPellet(userId: string, nickname: string) {
		console.log('Initalizing Other Pellet: ' + userId);
		var options = {
			top: 0,
			left: 0
		};
		// @ts-ignore
		options.radius = 12;

		let circle = new Circle({
			...options,
			fill: `#${userId}`,
			stroke: '#f9f9f9',
			strokeWidth: 3,
			strokeUniform: true,
			selectable: false,
			evented: false,
			hasControls: false,
			hasBorders: false
		});

		let text = new FabricText(nickname, {
			fontFamily: 'monospace',
			left: circle.left + circle.radius + 20,
			top: circle.top - circle.radius - 11,
			fontSize: 14,
			color: '#f9f9f9',
			evented: false,
			hasBorders: false,
			hasContext: false
		});

		let rect = new Rect({
			left: circle.left + circle.radius + 13,
			top: circle.top - circle.radius - 18,
			width: text.width + 10,
			height: text.height + 10,
			fill: `#${userId}`,
			stroke: '#f9f9f9',
			strokeWidth: 3,
			strokeUniform: true,
			evented: false,
			hasBorders: false,
			hasContext: false
		});

		let g = new Group([circle, rect, text], {
			top: (canvasWidth * 735) / 980 / 2,
			left: canvasWidth / 2,
			evented: false,
			hasBorders: false,
			hasControls: false
		});

		myCanvas.add(g);
		return g;
	}

	function updatePellet(
		otherUserId: string,
		coords: { x: number; y: number } | null,
		otherNickname: string
	) {
		// New user
		if (!others[otherUserId]) {
			log(`${otherNickname} a rejoint le spectrum`);
			others[otherUserId] = {
				pellet:
					!isNaN(coords.x) && !isNaN(coords.y) ? initOtherPellet(otherUserId, otherNickname) : null,
				targets: !isNaN(coords.x) && !isNaN(coords.y) ? [coords] : [],
				nickname: otherNickname
			};
		} else if (coords && !isNaN(coords.x) && !isNaN(coords.y)) {
			// known user
			others[otherUserId].targets.push(coords);

			// Only keep 5 points max
			if (others[otherUserId].targets.length >= 5)
				others[otherUserId].targets = others[otherUserId].targets.slice(1, 6);
		}

		if (others[otherUserId].cancel && coords != others[otherUserId].targets[0]) {
			others[otherUserId].cancel();
		}

		if (!isNaN(coords?.x) && !isNaN(coords?.y)) {
			if (others[otherUserId].validateOpinion) clearTimeout(others[otherUserId].validateOpinion);

			others[otherUserId].validateOpinion = setTimeout(() => {
				validateOpinion(otherUserId);
			}, 500);
		}
	}

	function deletePellet(otherUserId: string, keepUser: boolean = false) {
		if (others[otherUserId].cancel) {
			others[otherUserId].cancel();
		}

		if (others[otherUserId].pellet) {
			myCanvas.remove(others[otherUserId].pellet);
			myCanvas.renderAll();
		}

		if (!keepUser) {
			delete others[otherUserId];
		}
	}

	function receivedClaim(c: string) {
		console.log(c.replace(/^(\|\|)+|(\|\|)+$/g, ''));
		claim = c.replace(/^(\|\|)+|(\|\|)+$/g, '');
	}

	function sendEmoji(emojiIndex: number) {
		const emojis = ['😜', '🤚', '😵', '🤯', '🫣', '🛟', '🦝'];
		websocket.send('emoji ' + emojis[emojiIndex]);
	}

	function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
		let timer: ReturnType<typeof setTimeout>;
		return function (...args: Parameters<T>) {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), delay);
		} as T;
	}

	function lerp(a: number, b: number, t: number) {
		return a + (b - a) * t;
	}

	function animateCursors() {
		const t = 0.2;

		if (others) {
			for (const userId in others) {
				const { pellet, targets, nickname } = others[userId];
				if (!pellet) return;
				const currentX = pellet.left ?? 0;
				const currentY = pellet.top ?? 0;

				pellet.set({
					left: lerp(currentX, targets[targets.length - 1].x, t),
					top: lerp(currentY, targets[targets.length - 1].y, t)
				});
			}
		}

		myCanvas.requestRenderAll();
		requestAnimationFrame(animateCursors);
	}

	function updateMyPellet(force = false) {
		if (moving || force)
			websocket.send(
				`update ${userId} ${Math.round(myPellet.left / scale)},${Math.round(myPellet.top / scale)} ${nickname}`
			);
	}

	function drawCanvas(id: string) {
		// @ts-ignore
		const canvas = new Canvas(id);
		canvas.hoverCursor = 'pointer';
		canvas.selection = false;
		canvas.targetFindTolerance = 2;
		canvas.backgroundColor = 'white';

		let canvasHeight = (canvasWidth * 600) / 800;

		canvas.setDimensions({ width: canvasWidth, height: canvasHeight });

		return canvas;
	}

	function signIn() {
		websocket.send('signin ' + getUserId());
		//connected = true;
	}

	let isHoveringHistory = false;

	function log(message: string) {
		const now = new Date();
		const formattedDate = now.toLocaleString('fr-FR');
		logs.push(`[${formattedDate}] ${message}`);
		logs = logs;
		scrollToBottom();
	}

	let claimFocus = false;

	function parseCommand(line: string) {
		if (!listenning) return;

		const re = new RegExp(
			/^(ack|nack|update|claim|spectrum|newposition|userleft|madeadmin|receive)(\s+([0-9a-f]*))?(\s+([0-9N-]+,[0-9A-]+))?(\s+(.+))?$/gu
		);
		const matches = [...line.matchAll(re)][0];

		if (matches) {
			const command = matches[1].toString();
			const otherUserId = matches[3];
			let coords = null;

			if (matches[5]) {
				const s = matches[5].toString().split(',');
				coords = { x: parseInt(s[0]), y: parseInt(s[1]) };
			}

			if (command == 'ack') {
				if (!initialized) initialized = true;
				else initPellet();
			} else if (command == 'nack') {
				notifier.danger('Désolé, erreur reçue: ' + matches[7]);
			} else if (command == 'update') {
				if (otherUserId != userId) updatePellet(otherUserId, coords, matches[7]);
			} else if (command == 'userleft') {
				if (otherUserId != userId) {
					log(`${others[otherUserId].nickname} a quitté le spectrum`);
					deletePellet(otherUserId);
				}
			} else if (command == 'receive') {
				if (otherUserId != userId) {
					notifier.info(
						others[otherUserId].nickname + ' a envoyé : ' + matches[7].toString(),
						5000
					);
					log(`${others[otherUserId].nickname} a envoyé : ${matches[7]}`);
				} else {
					log(`Vous avez envoyé : ${matches[7]}`);
				}
			} else if (command == 'madeadmin') {
				if (otherUserId != userId) {
					deletePellet(otherUserId, true);
					log(`${others[otherUserId].nickname} a été élu admin`);
				} else {
					adminModeOn = true;
					myCanvas.remove(myPellet);
					myCanvas.renderAll();
					myPellet = null;
					log('Vous avez été élu admin');
				}
			} else if (command == 'newposition') {
				if (myPellet) {
					myPellet.left = coords.x * scale;
					myPellet.top = coords.y * scale;
					myPellet.setCoords();
					myCanvas.renderAll();
					updateMyPellet(true);
				}
				moving = false;
			} else if (command == 'claim') {
				if (!adminModeOn || (adminModeOn && !claimFocus)) {
					receivedClaim(matches[7]);

					clearTimeout(updateClaimLog);
					updateClaimLog = setTimeout(() => {
						log(`Claim: ${claim}`);
					}, 3000);
				}
			} else if (command == 'spectrum') {
				showJoinModal = false;
				userId = matches[3];
				const s = matches[7].toString().split(' ');
				nickname = s[1];
				if (s[2] == 'true') {
					adminModeOn = true;
				}
				joinedSpectrum(s[0]);
				log('Vous venez de rejoindre le spectrum.');
			}
		}
	}

	let updateClaimLog: number | undefined;
	let previousClaim: string | undefined;

	function connectionLost() {}

	function resetPositions() {
		websocket.send('resetpositions');
	}

	let initialClaim: string | undefined;
	function createSpectrum() {
		listenning = true;
		claim = initialClaim;
		initialClaim = '';
		websocket.send(`startspectrum ${nickname} ${userId}`);
		const modal = document.getElementById('create-modal');
		if (modal) modal.style.display = 'none';
		adminModeOn = true;
		websocket.send(`claim ${claim}`);
	}

	function joinSpectrum() {
		listenning = true;
		websocket.send(`joinspectrum ${spectrumId} ${nickname} ${userId}`);
	}

	let adminModeOn = false;
	function joinedSpectrum(id: string) {
		spectrumId = id;
		console.log(`spectrumId = ${id}`);

		if (!adminModeOn) {
			initPellet();
		}
	}

	function makeAdmin(id: string) {
		if (!adminModeOn) return;

		websocket.send(`makeadmin ${id}`);
	}

	let showJoinModal = false;
	let showSpectrumId = false;
	function toggleJoinModal() {
		showJoinModal = !showJoinModal;
	}
	function toggleShowSpectrumId() {
		showSpectrumId = !showSpectrumId;
	}

	let showCreateModal = false;
	function toggleCreateModal() {
		showCreateModal = !showCreateModal;
	}

	function leaveSpectrum() {
		listenning = false;
		websocket.send(`leavespectrum ${spectrumId}`);
		spectrumId = undefined;
		adminModeOn = false;
		myCanvas.remove(myPellet);
		for (const key in others) {
			if (others[key].pellet) myCanvas.remove(others[key].pellet);
			delete others[key];
		}
		myCanvas.renderAll();
	}

	const copied = () => {
		notifier.success('Lien du Spectrum copié!');
	};
</script>

<Header
	subtitle="Plate-forme de spectrum en ligne de 2 à 6 participants"
	logo={LOGO_URL}
	logoWidth={LOGO_WIDTH}
	offsetSubtitle={OFFSET_SUBSTITLE}
	title={HEADER_TITLE}
/>

<br />

<div class="m-4 font-mono">
	{#if !spectrumId}
		<div class="flex items-center">
			<button on:click={toggleCreateModal} class="btn osr-yellow float-left rounded px-4 py-2"
				>Créer un Spectrum</button
			>
			<button on:click={toggleJoinModal} class="btn osr-green float-left ml-4 rounded px-4 py-2"
				>Rejoindre un Spectrum</button
			>
		</div>
	{:else}
		<div class="flex items-center">
			<span class="float-left px-4 py-2">
				Spectrum en cours - Identifiant=<b>{showSpectrumId ? spectrumId : 'OSR-****'}</b><button
					class={showSpectrumId ? 'forbidden' : ''}
					style="background: none; border: none; outline: none; box-shadow: none;"
					on:click={toggleShowSpectrumId}>👁️</button
				>
			</span>

			<button
				class="btn osr-green rounded px-4 py-2"
				use:copy={{
					text: PUBLIC_URL + '/' + spectrumId,
					onCopy() {
						copied();
					}
				}}
			>
				<Fa icon={faCopy} /> Copier Lien
			</button>

			<button on:click={leaveSpectrum} class="btn osr-yellow float-right rounded px-4 py-2"
				><Fa icon={faPersonWalkingArrowRight} /> Quitter le Spectrum</button
			>
		</div>
	{/if}

	{#if showJoinModal}
		<div id="join-modal" class="w3-modal" style="display: block; z-index: 100;">
			<div class="w3-modal-content w3-card-4 w3-animate-zoom" style="max-width:600px">
				<div class="text-center">
					<br />
					<button
						on:click={toggleJoinModal}
						class="btn w3-xlarge w3-hover-red w3-display-topright"
						title="Close Modal"
						>&times;
					</button>
				</div>

				<form class="w3-container" on:submit|preventDefault={joinSpectrum}>
					<div class="w3-section">
						<label for="spectrumId"><b>Identifiant du Spectrum</b></label>
						<input
							class="w3-input mb-4 border"
							type="text"
							placeholder="Veuillez entrer l'identifiant du spectrum que vous voulez rejoindre"
							id="spectrumId"
							bind:value={spectrumId}
							style="width: 100%;"
							required
						/>
						<hr />
						<label for="nickname1"><b>Pseudo</b></label>
						<input
							class="w3-input mb-4 border"
							type="text"
							placeholder="Veuillez entrer un pseudo (n'utilisez pas votre nom réel)"
							bind:value={nickname}
							id="nickname1"
							style="width: 100%;"
							required
						/>
						<hr />
						<p><b>Choisissez une couleur</b></p>
						<div class="w3-container" style="display: flex; flex-wrap: wrap;">
							{#each Object.entries(palette) as [colorHex, colorName]}
								<div style="margin: 6px">
									<label class="form-control font-mono">
										<input
											class="w3-radio"
											type="radio"
											name="color"
											value={colorHex}
											bind:group={userId}
											style="background-color: #{colorHex} !important;"
										/>
										{@html colorName.replace(/ /g, '&nbsp;')}
									</label>
								</div>
							{/each}
						</div>
						<button class="btn w3-block osr-green w3-section p-4" type="submit"
							>Rejoindre le Spectrum</button
						>
					</div>
				</form>

				<div class="w3-container p-4-16 w3-light-grey border-t">
					<button on:click={toggleJoinModal} type="button" class="btn osr-yellow">Annuler</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showCreateModal}
		<div id="create-modal" class="w3-modal" style="display: block; z-index: 100;">
			<div class="w3-modal-content w3-card-4 w3-animate-zoom" style="max-width:600px">
				<div class="text-center">
					<br />
					<button
						on:click={toggleCreateModal}
						class="btn w3-xlarge w3-hover-red w3-display-topright"
						title="Close Modal">&times;</button
					>
				</div>

				<form class="w3-container" on:submit|preventDefault={createSpectrum}>
					<div class="w3-section">
						<label for="nickname2"><b>Pseudo</b></label>
						<input
							class="w3-input mb-4 border"
							type="text"
							placeholder="Veuillez entrer un pseudo (n'utilisez pas votre nom réel)"
							bind:value={nickname}
							id="nickname2"
							style="width: 100%;"
							required
						/>
						<hr />
						<label for="claim"><b>Claim initial</b></label>
						<input
							class="w3-input mb-4 border"
							type="text"
							placeholder="Veuillez entrer le claim"
							id="claim"
							style="width: 100%;"
							bind:value={initialClaim}
							required
						/>
						<hr />
						<p><b>Choisissez une couleur</b></p>
						<div class="w3-container" style="display: flex; flex-wrap: wrap;">
							{#each Object.entries(palette) as [colorHex, colorName]}
								<div style="margin: 6px">
									<label class="form-control font-mono">
										<input
											class="w3-radio"
											type="radio"
											name="color"
											value={colorHex}
											bind:group={userId}
											style="background-color: #{colorHex} !important;"
										/>
										{@html colorName.replace(/ /g, '&nbsp;')}
									</label>
								</div>
							{/each}
						</div>
						<button class="btn w3-block osr-green w3-section p-4" type="submit"
							>Créer un Spectrum</button
						>
					</div>
				</form>

				<div class="w3-container p-4-16 w3-light-grey border-t">
					<button on:click={toggleCreateModal} type="button" class="btn osr-yellow">Annuler</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<div class="mt-8 flex flex-wrap" style="position: relative;">
	{#if !spectrumId}
		<div class="overlay">Pas de spectrum en cours</div>
	{/if}
	<div class="w-2/3">
		<div class="card bg-base-100 w-full shadow-sm" style="min-width: 980px; max-width:980px" bind:clientWidth={canvasWidth}>
			<header class="p-0 font-mono">
				<label class="floating-label">
					<input
						name="claim"
						class="input input-lg !w-full"
						type="text"
						placeholder="Claim : "
						readonly={!adminModeOn}
						bind:value={claim}
						on:focusin={() => {
							claimFocus = true;
							previousClaim = claim;
						}}
						on:focusout={() => {
							claimFocus = false;
							if (claim != previousClaim) log(`Claim: ${claim}`);
						}}
						on:input={() => {
							if (adminModeOn) {
								websocket.send('claim ||' + claim + '||');
							}
						}}
					/>
					<span class="font-bold">Claim : </span>
				</label>
			</header>

			<div class="border-t p-0">
				<canvas class="m-auto" id="spectrum"></canvas>
			</div>

			<footer class="flex items-center" class:p-4={spectrumId}>
				{#if adminModeOn}
					<button
						class="btn btn-neutral mr-4 rounded-lg px-4 py-2 font-mono"
						on:click={resetPositions}
					>
						<Fa icon={faRotateLeft} /> Reset les Positions</button
					>

					<button class="btn btn-neutral mr-4 rounded-lg px-4 py-2 font-mono" on:click={initPellet}
						><Fa icon={faCirclePlus} /> Créer mon Palet</button
					>

					<button class="btn btn-neutral btn-disabled rounded-lg px-4 py-2 font-mono"
						><Fa icon={faStop} /> Clôturer le Spectrum</button
					>
				{/if}

				{#if spectrumId}
					<div
						class="dropdown dropdown-bottom dropdown-center float-right"
						style="font-style: normal; font-family: 'Segoe UI', 'Noto Color Emoji', 'Apple Color Emoji', 'Emoji', sans-serif;"
					>
						<div tabindex="0" role="button" class="btn btn-warning m-1 rounded-lg font-mono">
							😀 Emoji
						</div>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<ul
							tabindex="0"
							class="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm"
						>
							<li><a on:click={() => sendEmoji(0)}>😜</a></li>
							<li><a on:click={() => sendEmoji(1)}>🤚</a></li>
							<li><a on:click={() => sendEmoji(2)}>😵</a></li>
							<li><a on:click={() => sendEmoji(3)}>🤯</a></li>
							<li><a on:click={() => sendEmoji(4)}>🫣</a></li>
							<li><a on:click={() => sendEmoji(5)}>🛟</a></li>
							<li><a on:click={() => sendEmoji(6)}>🦝</a></li>
						</ul>
					</div>
				{/if}
			</footer>
		</div>
	</div>

	<div class="w-1/3">
		<div class="mb-4 font-mono">
			<table class="table">
				<colgroup>
					<col style="width: 10%;" />
					{#if adminModeOn}
						<col style="width: 40%;" />
						<col style="width: 50%;" />
					{:else}
						<col style="width: 90%;" />
					{/if}
				</colgroup>
				<tbody class="overflow-y-auto">
					<tr>
						<th class="text-center"><Fa icon={faPalette} /> </th>
						<th><Fa icon={faPerson} /> Participants</th>
						{#if adminModeOn}
							<th><Fa icon={faExclamation} /> Actions</th>
						{/if}
					</tr>
					{#if spectrumId}
						<tr>
							<td>
								<div style="background: #{userId}; clip-path: circle(10px);">&nbsp;</div>
							</td>
							<td>
								<span class="text-sm"><b>{nickname}{adminModeOn ? '*' : ''}</b> (Vous-même)</span>
							</td>
							{#if adminModeOn}
								<td> &nbsp; </td>
							{/if}
						</tr>
					{/if}
					{#each Object.entries(others) as [colorHex, other]}
						<tr>
							<td>
								<div style="background: #{colorHex}; clip-path: circle(10px);">&nbsp;</div>
							</td>
							<td>
								<span class="text-sm"><b>{other.nickname}</b></span>
							</td>
							{#if adminModeOn}
								<td>
									<div class="tooltip" data-tip="Retirer du spectrum">
										<button class="btn btn-error btn-ghost btn-circle btn-disabled float-right"><Fa icon={faUserSlash} /></button>
									</div>
									<div class="tooltip" data-tip="Rendre admin">
										<button
											class="btn btn-secondary btn-ghost btn-circle float-right"
											on:click={() => {
												makeAdmin(colorHex);
											}}><Fa icon={faCirclePlus} /></button
										>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div id="history" class="font-mono">
			<table class="table">
				<thead>
					<tr>
						<th><Fa icon={faNewspaper} /> Historique</th>
					</tr>
				</thead>
				<tbody
					class="overflow-y-auto"
					bind:this={tbodyRef}
					on:mouseenter={() => (isHoveringHistory = true)}
					on:mouseleave={() => (isHoveringHistory = false)}
				>
					{#each logs as log}
						<tr style="display: table; width: 100%;">
							<td>
								{#if log.includes('Claim: ')}
									<span class="text-sm"><b>{log}</b></span>
								{:else}
									<span class="text-sm">{log}</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<p>&nbsp;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>

<style>
	header {
		width: 100%;
	}

	input {
		width: max-content;
	}

	table {
		table-layout: fixed;
		box-shadow:
			0 2px 5px 0 rgba(0, 0, 0, 0.16),
			0 2px 10px 0 rgba(0, 0, 0, 0.12);
	}

	.overlay {
		box-shadow: 0 0 15px 5px rgba(0, 0, 0, 0.6);
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.7); /* semi-transparent black */
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: x-large;
		z-index: 10;
	}

	.osr-green {
		background-color: #10b1b1;
	}

	.osr-yellow {
		background-color: #ffc517;
	}

	#history tbody {
		max-height: 300px;
		display: block;
	}

	.form-control {
		font-family: system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.5rem;
		vertical-align: text-bottom;
		display: grid;
		grid-template-columns: 1.5rem auto;
		gap: 0.5rem;
	}

	input[type='radio'] {
		/* Add if not using autoprefixer */
		-webkit-appearance: none;
		/* Remove most all native input styles */
		appearance: none;
		/* For iOS < 15 */
		background-color: greenyellow;
		/* Not removed via appearance */
		margin: 0;

		font: inherit;

		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		transform: translateY(-0.075em);

		display: grid;

		place-content: center;
	}

	input[type='radio']::before {
		content: '';
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		transform: scale(0);
		transition: 120ms transform ease-in-out;
		box-shadow: inset 1rem 1rem rgb(244, 244, 244);
		/* Windows High Contrast Mode */
		/*background-color: CanvasText;*/
	}

	input[type='radio']:checked::before {
		transform: scale(1);
	}

	.forbidden::after {
		content: '🚫';
		position: relative;
		left: -19px;
		top: 0;
	}
</style>
