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
	import { getPlayerId } from '$lib/battleships/playerId';
	import { onMount, tick } from 'svelte';
	import { fabric } from 'fabric';
	import { copy } from 'svelte-copy';

	import { page } from '$app/stores';
	import { PUBLIC_URL } from '$lib/Env';

	const palette = {
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
	let currentOpinion = 'notReplied';
	let previousOpinion = 'notReplied';

	export let spectrumId;

	/**
	 * @type {number}
	 */
	let canvasWidth;

	/**
	 * @type {any}
	 */
	let myCanvas;

	/**
	 * @type {Promise<any>}
	 */
	//let stats;

	/**
	 * @type {number}
	 */
	const updateTick = 100;

	/**
	 * @type {WebSocket}
	 */
	let websocket;
	//let connected = false;
	/**
	 * @type {string}
	 */
	let userId;
	/**
	 * @type {string}
	 */
	let nickname;
	let initialized = false;
	let listenning = true;

	/**
	 * @type {string[]}
	 */
	let logs = [];

	/**
	 * @type {{ left: any; top: any; }}
	 */
	let myPellet;
	let moving = false;
	const cells = [];
	const cellsPoints = [];
	const others = {};

	let claim = '';
	let scale;

	let tbodyRef; // Reference to tbody

	function validateOpinion(otherUserId) {
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
		window.setPosition = (x, y) => {
			myPellet.left = x * scale;
			myPellet.top = y * scale;
			myPellet.setCoords();
			myCanvas.renderAll();
		};

		currentOpinion = 'notReplied';

		spectrumId = $page.params?.id;
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
		fabric.loadSVGFromURL(
			'/spectrum.svg',
			function (/** @type {any} */ objects, /** @type {any} */ options) {
				// @ts-ignore
				const svg = fabric.util.groupSVGElements(objects, options);

				let canvasHeight = (canvasWidth * 735) / 980;
				let g = new fabric.Group([], {
					width: canvasWidth,
					height: canvasHeight
				});

				svg.scaleToWidth(g.width);

				g.addWithUpdate(svg);

				g.top = 15;

				g.selectable = false;
				g.evented = false;

				const svgObjects = svg.getObjects();

				for (let i = 0; i <= 8; i++) {
					cells.push(svgObjects[i]);
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

				myCanvas.add(g);
				myCanvas.sendToBack(g);
			}
		);

		// We're joining a spectrum
		if (spectrumId) {
			toggleJoinModal();
		}
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
			userId = Object.keys(palette)[fabric.util.getRandomInt(0, Object.keys(palette).length - 1)];

		let circle = new fabric.Circle({
			...options,
			fill: `#${userId}`,
			stroke: '#f9f9f9',
			strokeWidth: 3,
			strokeUniform: true,
			hasBorders: false,
			hasContext: false
		});

		let text = new fabric.Text(nickname, {
			fontFamily: 'monospace',
			left: circle.left + circle.radius + 20,
			top: circle.top - circle.radius - 11,
			fontSize: 14,
			color: '#f9f9f9',
			hasBorders: false,
			hasContext: false,
			opacity: 0.5
		});

		let rect = new fabric.Rect({
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

		let g = new fabric.Group([circle, rect, text], {
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
	const pointInPolygon = function (polygon, point) {
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
	function initOtherPellet(userId, nickname) {
		console.log('Initalizing Other Pellet: ' + userId);
		var options = {
			top: 0,
			left: 0
		};
		// @ts-ignore
		options.radius = 12;

		let circle = new fabric.Circle({
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

		let text = new fabric.Text(nickname, {
			fontFamily: 'monospace',
			left: circle.left + circle.radius + 20,
			top: circle.top - circle.radius - 11,
			fontSize: 14,
			color: '#f9f9f9',
			evented: false,
			hasBorders: false,
			hasContext: false
		});

		let rect = new fabric.Rect({
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

		let g = new fabric.Group([circle, rect, text], {
			top: (canvasWidth * 735) / 980 / 2,
			left: canvasWidth / 2,
			evented: false,
			hasBorders: false,
			hasControls: false
		});

		myCanvas.add(g);
		return g;
	}

	/**
	 * @param {string} otherUserId
	 * @param {{ x: number; y: number; } | null} coords
	 */
	function updatePellet(otherUserId, coords, otherNickname) {
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

		if (!isNaN(coords.x) && !isNaN(coords.y)) {
			const cancel = animatePellet(otherUserId, coords);

			if (others[otherUserId].validateOpinion) clearTimeout(others[otherUserId].validateOpinion);

			others[otherUserId].validateOpinion = setTimeout(() => {
				validateOpinion(otherUserId);
			}, 500);

			others[otherUserId].cancel = () => {
				cancel.cancelX();
				cancel.cancelY();
			};
		}
	}

	function deletePellet(otherUserId, keepUser = false) {
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

	function receivedClaim(c) {
		console.log(c.replace(/^(\|\|)+|(\|\|)+$/g, ''));
		claim = c.replace(/^(\|\|)+|(\|\|)+$/g, '');
	}

	/**
	 * @param {number} emojiIndex
	 */
	function sendEmoji(emojiIndex) {
		const emojis = ['😜', '🤚', '😵', '🤯', '🫣', '🛟', '🦝'];
		websocket.send('emoji ' + emojis[emojiIndex]);
	}

	function animatePellet(userId, target) {
		return {
			cancelX: fabric.util.animate({
				startValue: others[userId].pellet.left,
				endValue: target.x * scale,
				duration: updateTick,
				onChange: function (value) {
					others[userId].pellet.set({ left: value });
					myCanvas.renderAll();
				},
				onComplete: function () {
					others[userId].pellet.setCoords();
				}
			}),
			cancelY: fabric.util.animate({
				startValue: others[userId].pellet.top,
				endValue: target.y * scale,
				duration: updateTick,
				onChange: function (value) {
					others[userId].pellet.set({ top: value });
					myCanvas.renderAll();
				},
				onComplete: function () {
					others[userId].pellet.setCoords();
				}
			})
		};
	}

	function updateMyPellet(force = false) {
		if (moving || force)
			websocket.send(
				`update ${userId} ${Math.round(myPellet.left / scale)},${Math.round(myPellet.top / scale)} ${nickname}`
			);
	}

	/**
	 * @param {string} id
	 */
	function drawCanvas(id) {
		// @ts-ignore
		const canvas = new fabric.Canvas(id);
		canvas.hoverCursor = 'pointer';
		canvas.selection = false;
		canvas.targetFindTolerance = 2;
		canvas.backgroundColor = 'white';

		let canvasHeight = (canvasWidth * 600) / 800;

		canvas.setDimensions({ width: canvasWidth, height: canvasHeight });

		return canvas;
	}

	function signIn() {
		websocket.send('signin ' + getPlayerId());
		//connected = true;
	}

	let isHoveringHistory = false;

	function log(message) {
		const now = new Date();
		const formattedDate = now.toLocaleString('fr-FR');
		logs.push(`[${formattedDate}] ${message}`);
		logs = logs;
		scrollToBottom();
	}

	let claimFocus = false;

	/**
	 * @param {string} line
	 */
	function parseCommand(line) {
		if (!listenning) return;

		const re = new RegExp(
			/^(ack|nack|update|claim|spectrum|newposition|userleft|madeadmin|receive)(\s+([0-9a-f]*))?(\s+([0-9N]+,[0-9A]+))?(\s+(.+))?$/gu
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

	let updateClaimLog;
	let previousClaim;

	function connectionLost() {}

	function resetPositions() {
		websocket.send('resetpositions');
	}

	let initialClaim;
	function createSpectrum() {
		listenning = true;
		claim = initialClaim;
		initialClaim = '';
		websocket.send(`startspectrum ${nickname} ${userId}`);
		document.getElementById('create-modal').style.display = 'none';
		adminModeOn = true;
		websocket.send(`claim ${claim}`);
	}

	function joinSpectrum() {
		listenning = true;
		websocket.send(`joinspectrum ${spectrumId} ${nickname} ${userId}`);
	}

	let adminModeOn = false;
	function joinedSpectrum(id) {
		spectrumId = id;
		console.log(`spectrumId = ${id}`);

		if (!adminModeOn) {
			initPellet();
		}
	}

	function makeAdmin(id) {
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

	/*
		OSR Color: 
		indigo #10b1b1 
		jaune #ffc517
		blanc #fffdfc
		black #000002
		olive #25291C
	*/
</script>

<!-- EN/US
<Header
	bind:clientWidth={canvasWidth}
	title="Spectrum"
	subtitle="Online tool to help you run spectrum online with a party of 2 to 6 people"
/>
-->

<Header
	title="Spectrum"
	subtitle="Plate-forme de spectrum en ligne de 2 à 6 participants"
	logo="/logo-osr.png"
/>

<br />

<div class="w3-container w3-margin" style="font-family: monospace;">
	{#if !spectrumId}
		<div class="w3-bar">
			<button on:click={toggleCreateModal} class="w3-bar-item w3-button osr-yellow w3-round w3-left"
				>Créer un Spectrum</button
			>
			<button
				on:click={toggleJoinModal}
				class="w3-margin-left w3-bar-item w3-button osr-green w3-round w3-left"
				>Rejoindre un Spectrum</button
			>
		</div>
	{:else}
		<div class="w3-bar">
			<span class="w3-bar-item w3-left">
				Spectrum en cours &mdash; identifiant=<b>{showSpectrumId ? spectrumId : 'OSR-****'}</b
				><button
					class={showSpectrumId ? 'forbidden' : ''}
					style="background: none; border: none; outline: none; box-shadow: none;"
					on:click={toggleShowSpectrumId}>👁️</button
				>
			</span>

			<button
				class="w3-button w3-bar-item w3-round osr-green"
				use:copy={PUBLIC_URL + '/' + spectrumId}
				on:svelte-copy={() => copied()}
			>
				<Fa icon={faCopy} /> Copier Lien
			</button>

			<button on:click={leaveSpectrum} class="w3-bar-item w3-round w3-button osr-yellow w3-right"
				><Fa icon={faPersonWalkingArrowRight} /> Quitter le Spectrum</button
			>
		</div>
	{/if}

	{#if showJoinModal}
		<div id="join-modal" class="w3-modal" style="display: block;">
			<div class="w3-modal-content w3-card-4 w3-animate-zoom" style="max-width:600px">
				<div class="w3-center">
					<br />
					<button
						on:click={toggleJoinModal}
						class="w3-button w3-xlarge w3-hover-red w3-display-topright"
						title="Close Modal"
						>&times;
					</button>
				</div>

				<form class="w3-container" on:submit|preventDefault={joinSpectrum}>
					<div class="w3-section">
						<label for="spectrumId"><b>Identifiant du Spectrum</b></label>
						<input
							class="w3-input w3-border w3-margin-bottom"
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
							class="w3-input w3-border w3-margin-bottom"
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
									<label class="form-control w3-monospace">
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
						<button class="w3-button w3-block osr-green w3-section w3-padding" type="submit"
							>Rejoindre le Spectrum</button
						>
					</div>
				</form>

				<div class="w3-container w3-border-top w3-padding-16 w3-light-grey">
					<button on:click={toggleJoinModal} type="button" class="w3-button osr-yellow"
						>Annuler</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if showCreateModal}
		<div id="create-modal" class="w3-modal" style="display: block;">
			<div class="w3-modal-content w3-card-4 w3-animate-zoom" style="max-width:600px">
				<div class="w3-center">
					<br />
					<button
						on:click={toggleCreateModal}
						class="w3-button w3-xlarge w3-hover-red w3-display-topright"
						title="Close Modal">&times;</button
					>
				</div>

				<form class="w3-container" on:submit|preventDefault={createSpectrum}>
					<div class="w3-section">
						<label for="nickname2"><b>Pseudo</b></label>
						<input
							class="w3-input w3-border w3-margin-bottom"
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
							class="w3-input w3-border w3-margin-bottom"
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
									<label class="form-control w3-monospace">
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
						<button class="w3-button w3-block osr-green w3-section w3-padding" type="submit"
							>Créer un Spectrum</button
						>
					</div>
				</form>

				<div class="w3-container w3-border-top w3-padding-16 w3-light-grey">
					<button on:click={toggleCreateModal} type="button" class="w3-button osr-yellow"
						>Annuler</button
					>
				</div>
			</div>
		</div>
	{/if}
</div>

<div class="w3-row">
	<div class="w3-twothird w3-col">
		<div class="w3-card w3-content" bind:clientWidth={canvasWidth}>
			<header class="w3-container" style="padding: 0; font-family: monospace;">
				<label for="claim" class="w3-col w3-padding" style="width: 10%; font-weight: bold"
					>Claim:</label
				>
				<input
					name="claim"
					class="w3-col w3-input w3-border-0"
					style="width: 90%; z-index: 100;"
					type="text"
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
			</header>

			<div
				class="w3-container w3-border-top"
				style="display: flex; flex-direction: column; padding: 0;"
			>
				<canvas style="margin: auto;" id="spectrum"></canvas>
			</div>

			<footer class="w3-bar" class:w3-padding={spectrumId}>
				{#if adminModeOn}
					<button
						class="w3-bar-item w3-mobile w3-button w3-black w3-text-white w3-round-large w3-monospace w3-margin-right"
						on:click={resetPositions}
					>
						<Fa icon={faRotateLeft} /> Reset les Positions</button
					>

					<button
						class="w3-bar-item w3-mobile w3-button w3-black w3-text-white w3-round-large w3-monospace w3-margin-right"
						on:click={initPellet}><Fa icon={faCirclePlus} /> Créer mon Palet</button
					>

					<button
						class="w3-bar-item w3-mobile w3-button w3-black w3-text-white w3-round-large w3-monospace w3-disabled"
						><Fa icon={faStop} /> Clôturer le Spectrum</button
					>
				{/if}

				{#if spectrumId}
					<div
						class="w3-dropdown-hover w3-mobile w3-right"
						style="font-style: normal; font-family: 'Segoe UI', 'Noto Color Emoji', 'Apple Color Emoji', 'Emoji', sans-serif;"
					>
						<button class="w3-button w3-round-large w3-mobile w3-yellow w3-monospace"
							>😀 Emoji</button
						>
						<div class="w3-dropdown-content">
							<button
								on:click={() => sendEmoji(0)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">😜</button
							>
							<button
								on:click={() => sendEmoji(1)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">🤚</button
							>
							<button
								on:click={() => sendEmoji(2)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">😵</button
							>
							<button
								on:click={() => sendEmoji(3)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">🤯</button
							>
							<button
								on:click={() => sendEmoji(4)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">🫣</button
							>
							<button
								on:click={() => sendEmoji(5)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">🛟</button
							>
							<button
								on:click={() => sendEmoji(6)}
								class="w3-bar-item w3-button w3-large w3-mobile w3-center">🦝</button
							>
						</div>
					</div>
				{/if}
			</footer>
		</div>
	</div>

	{#if spectrumId}
		<div class="w3-col w3-third">
			<div class="w3-container w3-responsive w3-monospace w3-margin-bottom">
				<table class="w3-table-all w3-striped w3-bordered">
					<colgroup>
						<col style="width: 10%;" />
						{#if adminModeOn}
							<col style="width: 40%;" />
							<col style="width: 50%;" />
						{:else}
							<col style="width: 90%;" />
						{/if}
					</colgroup>
					<tbody>
						<tr>
							<th class="w3-center"><Fa icon={faPalette} /> </th>
							<th><Fa icon={faPerson} /> Participant</th>
							{#if adminModeOn}
								<th><Fa icon={faExclamation} /> Actions</th>
							{/if}
						</tr>
						<tr>
							<td>
								<div style="background: #{userId}; clip-path: circle(10px);">&nbsp;</div>
							</td>
							<td>
								<span class="w3-small"><b>{nickname}{adminModeOn ? '*' : ''}</b> (Vous-même)</span>
							</td>
							{#if adminModeOn}
								<td> &nbsp; </td>
							{/if}
						</tr>
						{#each Object.entries(others) as [colorHex, other]}
							<tr>
								<td>
									<div style="background: #{colorHex}; clip-path: circle(10px);">&nbsp;</div>
								</td>
								<td>
									<span class="w3-small"><b>{other.nickname}</b></span>
								</td>
								{#if adminModeOn}
									<td>
										<button class="w3-button w3-right w3-disabled"
											><Fa icon={faUserSlash} />
											<span class="w3-small">Retirer du spectrum</span></button
										>
										<button
											class="w3-button w3-right"
											on:click={() => {
												makeAdmin(colorHex);
											}}
											><Fa icon={faCirclePlus} /> <span class="w3-small">Rendre admin</span></button
										>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div id="history" class="w3-container w3-responsive w3-monospace">
				<table class="w3-table-all w3-striped w3-bordered">
					<thead>
						<tr>
							<th><Fa icon={faNewspaper} /> Historique</th>
						</tr>
					</thead>
					<tbody
						bind:this={tbodyRef}
						on:mouseenter={() => (isHoveringHistory = true)}
						on:mouseleave={() => (isHoveringHistory = false)}
					>
						{#each logs as log}
							<tr style="display: table; width: 100%;">
								<td>
									{#if log.includes('Claim: ')}
										<span class="w3-small"><b>{log}</b></span>
									{:else}
										<span class="w3-small">{log}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
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

	.w3-dropdown-hover:first-child {
		background-color: transparent;
	}

	.w3-dropdown-content button:hover {
		background-color: #ccc;
	}

	.osr-green {
		background-color: #10b1b1;
	}

	.osr-yellow {
		background-color: #ffc517;
	}

	#history tbody {
		overflow-y: auto;
		max-height: 300px;
		display: block;
	}

	/*.osr-olive {
		background-color: #25291c;
	}*/

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
		left: -1rem;
		top: 0;
	}
</style>
