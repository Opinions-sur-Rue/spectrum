<script lang="ts">
	/* eslint-disable */
	// @ts-nocheck
	/* eslint svelte/no-at-html-tags: "off" */

	import Header from '$lib/components/Header.svelte';
	import { notifier } from '$lib/notifications';
	import {
		faCirclePlus,
		faCopy,
		faExclamation,
		faNewspaper,
		faPalette,
		faPerson,
		faPersonWalkingArrowRight,
		faPlus,
		faRightFromBracket,
		faRotateLeft,
		faStop,
		faUserSlash
	} from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';
	import { page } from '$app/state';
	import { getUserId } from '$lib/authentication/userId';
	import CreateSpectrumModal from '$lib/components/CreateSpectrumModal.svelte';
	import JoinSpectrumModal from '$lib/components/JoinSpectrumModal.svelte';
	import { HEADER_TITLE, LOGO_URL, LOGO_WIDTH, OFFSET_SUBSTITLE, PUBLIC_URL } from '$lib/env';
	import { palette } from '$lib/spectrum/palette';
	import { startWebsocket } from '$lib/spectrum/websocket';
	import { Canvas, Circle, FabricText, Group, loadSVGFromURL, Rect, util } from 'fabric';
	import { onMount, tick } from 'svelte';
	import { copy } from 'svelte-copy';
	import { lerp, pointInPolygon } from '$lib/utils';

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
	type OpinionKey = keyof typeof opinions;
	let currentOpinion: string = 'notReplied';
	let previousOpinion: string = 'notReplied';

	//let spectrumId: string | undefined = $state(undefined);
	let { id: spectrumId } = $props();

	const originalWidth = 980;
	const originalHeight = 735;

	let canvasWidth: number = $state(originalWidth);

	let myCanvas: Canvas;

	const updateTick: number = 100;

	let websocket: WebSocket;
	//let connected = false;

	let userId: string | undefined = $state();
	let nickname: string | undefined = $state();
	let initialized = false;
	let listenning = true;

	let logs: string[] = $state([]);

	let myPellet: any;
	let moving = false;
	const cells: any[] = [];
	const cellsPoints: any[] = [];
	const others: any = {};

	let claim: string | undefined = $state();
	let scale: number;

	let tbodyRef: any; // Reference to tbody

	function validateOpinion(otherUserId: string) {
		const target = others[otherUserId].pellet;

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];

			if (pointInPolygon(cellsPoints[i], [target.left, target.top])) {
				if (cell.id != 'notReplied') {
					log(`${others[otherUserId].nickname} est "${opinions[cell.id as OpinionKey]}"`);
				}
			}
		}
	}

	$effect(() => {
		if (canvasWidth) {
			scale = canvasWidth / originalWidth;
			if (myCanvas) {
				myCanvas.setDimensions({ width: canvasWidth, height: scale * originalHeight });

				svg.set({
					scaleX: scale,
					scaleY: scale,
					left: (canvasWidth - svg.width! * scale) / 2,
					top: 15 * scale
				});

				myPellet.set({
					scaleX: scale,
					scaleY: scale
				});

				Object.keys(others).forEach((key: string) => {
					if (others[key].pellet) {
						others[key].pellet.set({
							scaleX: scale,
							scaleY: scale
						});
					}
				});

				myCanvas.requestRenderAll();

				for (let i = 0; i < cells.length; i++) {
					const cell = cells[i];
					cellsPoints[i] = [];

					for (let index = 0; index < cell.path.length - 2; index++) {
						let pathPoint = cell.path[index];

						let p = [
							pathPoint[pathPoint.length - 2] * scale - 15 * scale,
							pathPoint[pathPoint.length - 1] * scale - 10 * scale
						];

						cellsPoints[i].push(p);
					}
				}
			}
		}
	});

	async function scrollToBottom() {
		await tick(); // Wait for UI to update
		if (tbodyRef && !isHoveringHistory) {
			tbodyRef.scrollTop = tbodyRef.scrollHeight;
		}
	}

	let svg: any;

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
					log(`Vous êtes "${opinions[currentOpinion as OpinionKey]}"`);
					previousOpinion = currentOpinion;
				}
			}
		});

		// @ts-ignore
		loadSVGFromURL('/spectrum.svg').then(({ objects, options }) => {
			// @ts-ignore
			svg = util.groupSVGElements(objects, options);

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
		const options = {
			top: 0,
			left: 0,
			radius: 12
		};

		// only if not assigned, then random
		if (!userId)
			userId = Object.keys(palette)[util.getRandomInt(0, Object.keys(palette).length - 1)];

		if (!nickname) nickname = 'Participant ' + (Math.floor(Math.random() * 100) + 1);

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
			top: (canvasWidth * originalHeight) / originalWidth / 2,
			left: canvasWidth / 2,
			scaleX: scale,
			scaleY: scale,
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
						console.log([myPellet.left, myPellet.top]);
					}
				}
			}
		});

		setInterval(updateMyPellet, updateTick);
	}

	/**
	 * @param {string} userId
	 */
	function initOtherPellet(userId: string, nickname: string) {
		console.log('Initalizing Other Pellet: ' + userId);
		const options = {
			top: 0,
			left: 0,
			radius: 12
		};

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
			top: (canvasWidth * originalHeight) / originalWidth / 2,
			left: canvasWidth / 2,
			scaleX: scale,
			scaleY: scale,
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
					coords && !isNaN(coords.x) && !isNaN(coords.y)
						? initOtherPellet(otherUserId, otherNickname)
						: null,
				targets: coords && !isNaN(coords.x) && !isNaN(coords.y) ? [coords] : [],
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

		if (coords && (!isNaN(coords.x) || !isNaN(coords.y))) {
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

	function animateCursors() {
		const t = 0.2;

		if (others) {
			for (const userId in others) {
				const { pellet, targets, nickname } = others[userId];
				if (!pellet) return;
				const currentX = pellet.left ?? 0;
				const currentY = pellet.top ?? 0;

				pellet.set({
					left: lerp(currentX, targets[targets.length - 1].x * scale, t),
					top: lerp(currentY, targets[targets.length - 1].y * scale, t)
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
				if (myPellet && coords) {
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

	function onCreateSpectrum(nickname: string, initialClaim: string, userId: string) {
		listenning = true;
		claim = initialClaim;
		websocket.send(`startspectrum ${nickname} ${userId}`);
		showCreateModal = false;
		adminModeOn = true;
		websocket.send(`claim ${claim}`);
	}

	function onJoinSpectrum(spectrumId: string, nickname: string, userId: string) {
		listenning = true;
		websocket.send(`joinspectrum ${spectrumId} ${nickname} ${userId}`);
	}

	let adminModeOn: boolean = $state(false);
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

	let showSpectrumId = $state(false);

	let showJoinModal = $state(false);

	function toggleJoinModal() {
		showJoinModal = !showJoinModal;
	}
	function toggleShowSpectrumId() {
		showSpectrumId = !showSpectrumId;
	}

	let showCreateModal = $state(false);
	function toggleCreateModal() {
		showCreateModal = !showCreateModal;
		console.log(showCreateModal);
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

<CreateSpectrumModal bind:toggle={showCreateModal} onSubmit={onCreateSpectrum} />
<JoinSpectrumModal bind:toggle={showJoinModal} onSubmit={onJoinSpectrum} {spectrumId} />

<div class="m-4 mt-8 flex flex-wrap justify-center gap-4 font-mono">
	{#if !spectrumId}
		<button onclick={toggleCreateModal} class="btn btn-warning rounded-lg px-4 py-2"
			><Fa icon={faPlus} />Démarrer un Spectrum</button
		>
		<button onclick={toggleJoinModal} class="btn btn-success rounded-lg px-4 py-2"
			><Fa icon={faRightFromBracket} />Rejoindre un Spectrum</button
		>
	{:else}
		<span class="float-left px-4 py-2">
			<div class="inline-grid *:[grid-area:1/1]">
				<div class="status status-success"></div>
			</div>
			Spectrum en cours - Identifiant=<b>{showSpectrumId ? spectrumId : 'OSR-****'}</b><button
				class={showSpectrumId ? 'forbidden' : ''}
				style="background: none; border: none; outline: none; box-shadow: none;"
				onclick={toggleShowSpectrumId}>👁️</button
			>
		</span>

		<button
			class="btn btn-success rounded-lg px-4 py-2"
			use:copy={{
				text: PUBLIC_URL + '/' + spectrumId,
				onCopy() {
					copied();
				}
			}}
		>
			<Fa icon={faCopy} /> Copier Lien
		</button>

		<button onclick={leaveSpectrum} class="btn btn-warning float-right rounded-lg px-4 py-2"
			><Fa icon={faPersonWalkingArrowRight} /> Quitter le Spectrum</button
		>
	{/if}
</div>

<div class="mt-8 flex flex-wrap" style="position: relative;">
	{#if !spectrumId}
		<div class="overlay glass">Pas de spectrum en cours</div>
	{/if}
	<div class="mb-4 w-full md:w-3/4 md:pr-2 lg:w-2/3 lg:pr-4">
		<div class="card bg-base-100 w-full shadow-sm" bind:clientWidth={canvasWidth}>
			<header class="p-0 font-mono">
				<label class="floating-label">
					<input
						name="claim"
						class="input input-lg !w-full"
						type="text"
						placeholder="Claim"
						readonly={!adminModeOn}
						bind:value={claim}
						onfocusin={() => {
							claimFocus = true;
							previousClaim = claim;
						}}
						onfocusout={() => {
							claimFocus = false;
							if (claim != previousClaim) log(`Claim: ${claim}`);
						}}
						oninput={() => {
							if (adminModeOn) {
								websocket.send('claim ||' + claim + '||');
							}
						}}
					/>
					<span class="font-bold">Claim</span>
				</label>
			</header>

			<div class="border-t p-0">
				<canvas class="m-auto" id="spectrum"></canvas>
			</div>

			<footer class="flex flex-wrap items-center justify-center gap-4" class:p-4={spectrumId}>
				{#if adminModeOn}
					<button class="btn btn-neutral rounded-lg px-4 py-2 font-mono" onclick={resetPositions}>
						<Fa icon={faRotateLeft} /><span class="hidden lg:!inline-block">
							Reset les Positions</span
						></button
					>

					<button class="btn btn-neutral rounded-lg px-4 py-2 font-mono" onclick={initPellet}
						><Fa icon={faCirclePlus} /><span class="hidden lg:!inline-block">
							Créer mon Palet</span
						></button
					>

					<button class="btn btn-neutral btn-disabled rounded-lg px-4 py-2 font-mono"
						><Fa icon={faStop} /><span class="hidden lg:!inline-block">
							Clôturer le Spectrum</span
						></button
					>
				{/if}

				{#if spectrumId}
					<div
						class="dropdown dropdown-top dropdown-center"
						style="font-style: normal; font-family: 'Segoe UI', 'Noto Color Emoji', 'Apple Color Emoji', 'Emoji', sans-serif;"
					>
						<div tabindex="0" role="button" class="btn btn-warning rounded-lg font-mono">
							😀 Emoji
						</div>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<ul
							tabindex="0"
							class="dropdown-content menu bg-base-100 rounded-box z-1 w-12 p-2 shadow-sm"
						>
							<li><button onclick={() => sendEmoji(0)}>😜</button></li>
							<li><button onclick={() => sendEmoji(1)}>🤚</button></li>
							<li><button onclick={() => sendEmoji(2)}>😵</button></li>
							<li><button onclick={() => sendEmoji(3)}>🤯</button></li>
							<li><button onclick={() => sendEmoji(4)}>🫣</button></li>
							<li><button onclick={() => sendEmoji(5)}>🛟</button></li>
							<li><button onclick={() => sendEmoji(6)}>🦝</button></li>
						</ul>
					</div>
				{/if}
			</footer>
		</div>
	</div>

	<div class="w-full md:w-1/4 lg:w-1/3">
		<div
			class="card bg-base-100 card-border border-base-300 from-base-content/5 mb-4 bg-linear-to-bl to-50% font-mono"
		>
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
								<div class="inline-grid *:[grid-area:1/1]">
									<div class="status" style="background: #{userId}; color: #{userId}"></div>
								</div>
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
						<tr class="odd:bg-white even:bg-gray-50">
							<td>
								<div class="inline-grid *:[grid-area:1/1]">
									<div class="status" style="background: #{colorHex}; color: #{colorHex}"></div>
								</div>
							</td>
							<td>
								<span class="text-sm"><b>{other.nickname}</b></span>
							</td>
							{#if adminModeOn}
								<td>
									<div class="tooltip" data-tip="Retirer du spectrum">
										<button class="btn btn-error btn-ghost btn-circle btn-disabled float-right"
											><Fa icon={faUserSlash} /></button
										>
									</div>
									<div class="tooltip" data-tip="Rendre admin">
										<button
											class="btn btn-secondary btn-ghost btn-circle float-right"
											onclick={() => {
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
		<div
			id="history"
			class="card bg-base-100 card-border border-base-300 from-base-content/5 bg-linear-to-bl to-50% font-mono"
		>
			<table class="table">
				<thead>
					<tr>
						<th><Fa icon={faNewspaper} /> Historique</th>
					</tr>
				</thead>
				<tbody
					class="overflow-y-auto"
					bind:this={tbodyRef}
					onmouseenter={() => (isHoveringHistory = true)}
					onmouseleave={() => (isHoveringHistory = false)}
				>
					{#each logs as log}
						<tr class="odd:bg-white even:bg-gray-50">
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

	#history tbody {
		max-height: 300px;
		display: block;
	}

	.forbidden::after {
		content: '🚫';
		position: relative;
		left: -19px;
		top: 0;
	}
</style>
