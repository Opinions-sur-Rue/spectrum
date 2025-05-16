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
		faEye,
		faEyeSlash,
		faLock,
		faMapPin,
		faMicrophone,
		faMicrophoneSlash,
		faNewspaper,
		faPalette,
		faPerson,
		faPersonWalkingArrowRight,
		faPlayCircle,
		faRightFromBracket,
		faRotateLeft,
		faSatelliteDish,
		faStop,
		faUserSlash
	} from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';
	import { page } from '$app/state';
	import { getUserId } from '$lib/authentication/userId';
	import CreateSpectrumModal from '$lib/components/CreateSpectrumModal.svelte';
	import JoinSpectrumModal from '$lib/components/JoinSpectrumModal.svelte';
	import {
		ENABLE_AUDIO,
		HEADER_TITLE,
		LOGO_URL,
		LOGO_WIDTH,
		OFFSET_SUBSTITLE,
		PUBLIC_URL
	} from '$lib/env';
	import { startWebsocket } from '$lib/spectrum/websocket';
	import { Canvas, Circle, FabricText, Group, loadSVGFromURL, Rect, util } from 'fabric';
	import { onMount, tick } from 'svelte';
	import { copy } from 'svelte-copy';
	import { lerp, pointInPolygon } from '$lib/utils';
	import Peer from 'peerjs';
	import * as pkg from 'peerjs';
	import EmojiBurst from '$lib/components/EmojiBurst.svelte';

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

	let { id: spectrumId }: { id: string | undefined } = $props();

	const originalWidth = 980;
	const originalHeight = 735;

	let canvasWidth: number = $state(originalWidth);

	let myCanvas: Canvas;

	const updateTick: number = 100;

	let websocket: WebSocket;

	let userId: string | undefined = $state();
	let nickname: string | undefined = $state();
	let initialized = false;
	let listenning = true;

	let logs: string[] = $state([]);

	let myPellet: any;
	let moving = false;
	const cells: any[] = [];
	const cellsPoints: any[] = [];
	const others: any = $state({});

	let claim: string | undefined = $state();
	let scale: number;

	let tbodyRef: any; // Reference to tbody

	let localStream: MediaStream | undefined;
	let peer: Peer;
	let peerId: string | undefined = $state();
	let peerConnected = $state(false);
	const connections = new Map<string, pkg.MediaConnection>();
	let microphone: boolean = $state(false);

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

				myPellet?.set({
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

	$effect(() => {
		if (ENABLE_AUDIO) {
			if (microphone) {
				localStream?.getTracks().forEach((track) => (track.enabled = true));
				websocket?.send(`microphoneunmute ${userId} ${peerId}`);
			} else {
				localStream?.getTracks().forEach((track) => (track.enabled = false));
				websocket?.send(`microphonemute ${userId} ${peerId}`);
			}
		}
	});

	$effect(() => {
		if (ENABLE_AUDIO) {
			if (spectrumId && peerId && userId) {
				websocket.send(`voicechat ${userId} ${peerId}`);
				websocket.send(`microphonemute ${userId} ${peerId}`);
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
	let averageVoice: number = $state(0);
	let voiceIndicator = $derived(1 + averageVoice / 100);
	let otherVoices = $derived.by(() => {
		const voices: any = {};
		for (const [key, other] of Object.entries(others)) {
			voices[key] = 1 + ((other as any).averageVoice ?? 0) / 100;
		}
		return voices;
	});

	async function getAudioStream() {
		try {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});
			localStream?.getTracks().forEach((track) => (track.enabled = false));
			const audioContext = new (window.AudioContext || window.webkitAudioContext)();

			const source = audioContext.createMediaStreamSource(localStream);

			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 512;

			source.connect(analyser);

			const dataArray = new Uint8Array(analyser.frequencyBinCount);

			function detectVoice() {
				analyser.getByteFrequencyData(dataArray);
				let values = 0;

				for (let i = 0; i < dataArray.length; i++) {
					values += dataArray[i];
				}

				const average = values / dataArray.length;

				if (average > 20) {
					averageVoice = average;
				} else {
					averageVoice = 0;
				}

				requestAnimationFrame(detectVoice);
			}

			detectVoice();
		} catch (err) {
			console.error('Error accessing microphone:', err);
		}
	}

	function playAudio(voiceId: string, stream: MediaStream) {
		let otherId: string | undefined;
		for (const [key, value] of Object.entries(others)) {
			if ((value as any).voiceId === voiceId) {
				otherId = key;
				break;
			}
		}
		if (!otherId) return;

		const audio = new Audio();
		audio.srcObject = stream;
		audio.autoplay = true;
		audio.play().catch(console.error);

		const audioContext = new (window.AudioContext || window.webkitAudioContext)();

		const source = audioContext.createMediaStreamSource(stream);

		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 512;

		source.connect(analyser);

		const dataArray = new Uint8Array(analyser.frequencyBinCount);

		function detectVoice() {
			analyser.getByteFrequencyData(dataArray);
			let values = 0;

			for (let i = 0; i < dataArray.length; i++) {
				values += dataArray[i];
			}

			const average = values / dataArray.length;

			if (average > 20) {
				others[otherId!].averageVoice = average;
			} else {
				others[otherId!].averageVoice = 0;
			}

			requestAnimationFrame(detectVoice);
		}

		detectVoice();
	}

	function connectToPeer() {
		// If a peer instance already exists, destroy it
		if (peer && !peer.destroyed) {
			peer.destroy();
		}

		const options = {
			host: 'spectrum.utile.space',
			port: 443,
			path: '/peerjs',
			secure: true, // if using HTTPS

			config: {
				iceServers: [
					{ urls: 'stun:spectrum.utile.space:3478' },
					{
						urls: 'turn:spectrum.utile.space:3478',
						username: 'testuser',
						credential: 'testpassword'
					}
				]
			}
		};

		peer = new Peer(options);

		// Handle the 'open' event
		peer.on('open', (id) => {
			console.log(`Connected with ID: ${id}`);
			peerId = id;
			peerConnected = true;
			// Proceed with establishing connections or calls
		});

		// Handle errors
		peer.on('error', (err) => {
			console.error('Peer error:', err);
			if (err.type === 'unavailable-id') {
				peerConnected = false;
				// Retry after a delay if the ID is still considered in use
				setTimeout(() => connectToPeer(), 1000);
			} else if (err.type === 'peer-unavailable') {
				console.log('Failed to connect with peer, trying again');
				const match = err.message.match(/[0-9a-fA-F\-]{36}$/);
				if (match) {
					const peerId = match[0];
					console.log('Peer ID:', peerId);
					peer.call(peerId, localStream!);
				} else {
					console.log('No peer ID found in error message.');
				}
			}
		});

		// Handle disconnection
		peer.on('disconnected', () => {
			peerConnected = false;
			console.warn('Peer disconnected. Attempting to reconnect...');
			peer.reconnect();
		});

		peer.on('call', (call) => {
			call.answer(localStream);
			call.on('stream', (remoteStream) => playAudio(call.peer, remoteStream));
			if (connections.has(call.peer) == false) {
				console.log('CALLING BACK', call.peer);
				//attemptCallWithLimit(peer, call.peer, localStream);
				connections.set(call.peer, call);
			}
		});
	}

	onMount(() => {
		if (ENABLE_AUDIO) {
			getAudioStream().then(() => {
				connectToPeer();
			});
		}

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
	});

	function initPellet() {
		console.log('Initalizing Your Pellet');
		if (!userId) return false;

		const options = {
			top: 0,
			left: 0,
			radius: 12
		};

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
			fill: '#ffffff',
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
			stroke: '#e0e0e0',
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
			fill: '#ffffff',
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
			stroke: '#e0e0e0',
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
				target: coords && !isNaN(coords.x) && !isNaN(coords.y) ? coords : undefined,
				nickname: otherNickname,
				microphone: false
			};
		} else if (coords && !isNaN(coords.x) && !isNaN(coords.y)) {
			// known user
			others[otherUserId].target = coords;
		}

		if (coords && (!isNaN(coords.x) || !isNaN(coords.y))) {
			if (others[otherUserId].validateOpinion) clearTimeout(others[otherUserId].validateOpinion);

			others[otherUserId].validateOpinion = setTimeout(() => {
				validateOpinion(otherUserId);
			}, 500);
		}
	}

	function deletePellet(otherUserId: string, keepUser: boolean = false) {
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

	let trigger = $state(false);
	let emoji: string = $state('');

	function sendEmoji(emojiIndex: number) {
		const emojis = ['😜', '🤚', '😵', '🤯', '🫣', '🛟', '🦝'];
		websocket.send('emoji ' + emojis[emojiIndex]);
	}

	function animatePellets() {
		const t = 0.2;

		for (const userId of Object.keys(others)) {
			const pellet = others[userId].pellet;
			const target = others[userId].target;

			if (!pellet) continue;
			const currentX = pellet.left ?? 0;
			const currentY = pellet.top ?? 0;

			pellet.set({
				left: lerp(currentX, target.x * scale, t),
				top: lerp(currentY, target.y * scale, t)
			});
		}

		myCanvas.requestRenderAll();
		requestAnimationFrame(animatePellets);
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
			/^(ack|nack|update|claim|spectrum|newposition|userleft|madeadmin|receive|voicechat|microphonemute|microphoneunmute)(\s+([0-9a-f]*))?(\s+([0-9N-]+,[0-9A-]+))?(\s+(.+))?$/gu
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
				} else {
					log(`Vous avez quitté le spectrum`);
					leaveSpectrum();
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
				trigger = false;
				emoji = matches[7];
				requestAnimationFrame(() => (trigger = true)); // retrigger animation
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
			} else if (command == 'voicechat') {
				if (otherUserId != userId) {
					const voiceId = matches[7].toString();
					others[otherUserId].voiceId = voiceId;
					attemptCallWithLimit(peer, voiceId, localStream);
				}
			} else if (command == 'microphonemute') {
				if (otherUserId != userId) {
					others[otherUserId].microphone = false;
				}
			} else if (command == 'microphoneunmute') {
				if (otherUserId != userId) {
					others[otherUserId].microphone = true;
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

	function attemptCallWithLimit(
		peer: Peer | undefined,
		targetId: string,
		localStream: MediaStream | undefined,
		maxRetries: number = 5,
		attempt: number = 1
	) {
		if (peer && localStream) {
			connections.set(targetId, peer.call(targetId, localStream));
		} else if (attempt <= maxRetries) {
			setTimeout(() => {
				attemptCallWithLimit(peer, targetId, localStream, maxRetries, attempt + 1);
			}, 1000); // Retry after 1 second
		} else {
			console.error('Failed to establish peer connection after maximum retries.');
		}
	}

	let updateClaimLog: number | undefined;
	let previousClaim: string | undefined;

	function connectionLost() {
		notifier.danger('Impossible de se connecter au serveur de spectrum');
	}

	function resetPositions() {
		websocket.send('resetpositions');
	}

	function onCreateSpectrum(nickname: string, initialClaim: string) {
		listenning = true;
		claim = initialClaim;
		websocket.send(`startspectrum ${nickname}`);
		showCreateModal = false;
		adminModeOn = true;
		websocket.send(`claim ${claim}`);
	}

	function onJoinSpectrum(spectrumId: string, nickname: string) {
		listenning = true;
		websocket.send(`joinspectrum ${spectrumId} ${nickname}`);
	}

	let adminModeOn: boolean = $state(false);
	function joinedSpectrum(id: string) {
		spectrumId = id;
		console.log(`spectrumId = ${id}`);

		if (!adminModeOn) {
			initPellet();
		}

		animatePellets();
	}

	function makeAdmin(id: string) {
		if (!adminModeOn) return;

		websocket.send(`makeadmin ${id}`);
	}

	function kick(id: string) {
		if (!adminModeOn) return;

		websocket.send(`kick ${id}`);
	}

	let showSpectrumId = $state(false);

	let showJoinModal = $state(false);

	function toggleJoinModal() {
		showJoinModal = !showJoinModal;
	}

	let showCreateModal = $state(false);
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
		peer.disconnect();
	}

	const copied = () => {
		notifier.success('Lien du Spectrum copié!');
	};

	let streamerMode = $state(false);
</script>

<CreateSpectrumModal bind:toggle={showCreateModal} onSubmit={onCreateSpectrum} />
<JoinSpectrumModal bind:toggle={showJoinModal} onSubmit={onJoinSpectrum} {spectrumId} />
<EmojiBurst {emoji} {trigger} />

{#if !streamerMode}
	<Header
		subtitle="Plate-forme de spectrum en ligne de 2 à 6 participants"
		logo={LOGO_URL}
		logoWidth={LOGO_WIDTH}
		offsetSubtitle={OFFSET_SUBSTITLE}
		title={HEADER_TITLE}
	/>

	{#if ENABLE_AUDIO}
		<div class="inline-grid *:[grid-area:1/1]">
			{#if !peerConnected}
				<div class="status status-error animate-ping"></div>
				<div class="status status-error"></div>
			{:else}
				<div class="status status-success animate-ping"></div>
				<div class="status status-success"></div>
			{/if}
		</div>
	{/if}

	<div class="m-4 mt-8 flex flex-wrap items-center justify-center gap-4 font-mono">
		<span class="px-4 py-2">
			<div class="inline-grid *:[grid-area:1/1]">
				<div class={spectrumId ? 'status status-success' : 'status status-error'}></div>
			</div>
			{#if spectrumId}
				<span class="inline-flex items-center">
					Spectrum en cours &mdash; Identifiant=<b>{showSpectrumId ? spectrumId : 'OSR-****'}</b>
					<div
						class="tooltip inline-block align-baseline"
						data-tip={showSpectrumId ? "Cacher l'identifiant" : "Montrer l'identifiant"}
					>
						<label class="swap">
							<input type="checkbox" class="hidden" bind:checked={showSpectrumId} />
							<div class="swap-on btn btn-ghost btn-circle"><Fa icon={faEye} /></div>
							<div class="swap-off btn btn-ghost btn-circle"><Fa icon={faEyeSlash} /></div>
						</label>
					</div>
				</span>
			{:else}
				Pas de Spectrum en cours
			{/if}
		</span>

		{#if spectrumId}
			<button
				class="btn btn-success rounded-lg px-4 py-2"
				use:copy={{
					text: PUBLIC_URL + '/' + spectrumId,
					onCopy() {
						copied();
					}
				}}
			>
				<Fa icon={faCopy} /> Copier le lien
			</button>
			<button onclick={() => (streamerMode = true)} class="btn btn-info rounded-lg px-4 py-2"
				><Fa icon={faSatelliteDish} />Streamer Mode</button
			>
			<button onclick={leaveSpectrum} class="btn btn-warning float-right rounded-lg px-4 py-2"
				><Fa icon={faPersonWalkingArrowRight} /> Quitter le Spectrum</button
			>
		{:else}
			<button onclick={toggleCreateModal} class="btn btn-warning rounded-lg px-4 py-2"
				><Fa icon={faPlayCircle} />Démarrer un Spectrum</button
			>
			<button onclick={toggleJoinModal} class="btn btn-success rounded-lg px-4 py-2"
				><Fa icon={faRightFromBracket} />Rejoindre un Spectrum</button
			>
		{/if}
	</div>
{:else}
	<div class="fixed top-5 right-5 z-1000">
		<div class="tooltip tooltip-left" data-tip="Quitter mode streamer">
			<button onclick={() => (streamerMode = false)} class="btn btn-info btn-circle"
				><Fa icon={faSatelliteDish} /></button
			>
		</div>
	</div>
{/if}

<div class="relative mt-8 flex flex-wrap">
	<div class="mb-4 w-full md:w-3/4 md:pr-2 lg:w-2/3 lg:pr-4">
		<div class="card bg-base-100 w-full shadow-sm" bind:clientWidth={canvasWidth}>
			<header class="w-full p-0 font-mono">
				<label class="floating-label">
					<input
						name="claim"
						class="input {!streamerMode ? 'input-lg' : 'input-xl'} !w-full"
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
					<span class="font-bold"><Fa icon={faMapPin} /> Claim</span>
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

					<!--<button class="btn btn-neutral rounded-lg px-4 py-2 font-mono" onclick={initPellet}
						><Fa icon={faCirclePlus} /><span class="hidden lg:!inline-block">
							Créer mon Palet</span
						></button
						>-->

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
		{#if !streamerMode}
			<div
				class="card bg-base-100 card-border border-base-300 from-base-content/5 mb-4 bg-linear-to-bl to-50% font-mono"
			>
				<table class="table">
					<colgroup>
						<col style="width: 10%;" />
						<col style="width: 40%;" />
						<col style="width: 50%;" />
					</colgroup>
					<tbody class="overflow-y-auto">
						<tr>
							<th class="text-center"><Fa icon={faPalette} /></th>
							<th><Fa icon={faPerson} /> Participants</th>
							<th><Fa icon={faExclamation} /> Actions</th>
						</tr>
						{#if spectrumId}
							<tr>
								<td>
									<div class="inline-grid *:[grid-area:1/1]">
										<div
											class="status status-lg animate-ping transition-transform duration-100"
											style="transform: scale({voiceIndicator})"
										></div>
										<div
											class="status status-lg"
											style="background: #{userId}; color: #{userId}; transform: scale({voiceIndicator})"
										></div>
									</div>
								</td>
								<td>
									<span class="text-sm"><b>{nickname}{adminModeOn ? '*' : ''}</b> (Vous-même)</span>
								</td>
								<td>
									{#if ENABLE_AUDIO}
										<div
											class="tooltip"
											data-tip={microphone ? 'Éteindre le micro' : 'Allumer le micro'}
										>
											<label class="swap">
												<input type="checkbox" class="hidden" bind:checked={microphone} />
												<div class="swap-on btn btn-ghost btn-square rounded-xl">
													<Fa icon={faMicrophone} />
												</div>
												<div
													class="swap-off btn btn-square rounded-xl border-0 bg-red-500/20 text-red-500"
												>
													<Fa icon={faMicrophoneSlash} />
												</div>
											</label>
										</div>
									{/if}
								</td>
							</tr>
						{/if}
						{#each Object.entries(others) as [colorHex, other]}
							<tr class="odd:bg-white even:bg-gray-50">
								<td>
									<div class="inline-grid *:[grid-area:1/1]">
										<div
											class="status status-lg animate-ping transition-transform duration-100"
											style="transform: scale({otherVoices[colorHex]})"
										></div>
										<div
											class="status status-lg"
											style="background: #{colorHex}; color: #{colorHex}; transform: scale({otherVoices[
												colorHex
											]})"
										></div>
									</div>
								</td>
								<td>
									{#if ENABLE_AUDIO}
										<label
											class="swap swap-flip cursor-default"
											class:swap-active={(other as any).microphone}
										>
											<div class="swap-on">
												<Fa icon={faMicrophone} />
											</div>
											<div class="swap-off text-red-500">
												<Fa icon={faMicrophoneSlash} />
											</div>
										</label>
									{/if}
									<span class="text-sm"><b>{(other as any).nickname}</b></span>
								</td>
								<td>
									{#if adminModeOn}
										<div class="tooltip" data-tip="Retirer du spectrum">
											<button
												class="btn btn-square rounded-xl border-0 bg-orange-500/20 text-orange-500"
												onclick={() => {
													kick(colorHex);
												}}><Fa icon={faUserSlash} /></button
											>
										</div>
										<div class="tooltip" data-tip="Rendre admin">
											<button
												class="btn btn-square rounded-xl border-0 bg-amber-500/20 text-amber-500"
												onclick={() => {
													makeAdmin(colorHex);
												}}><Fa icon={faLock} /></button
											>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="mb-4 grid grid-cols-3 gap-4">
				<div class="card bg-base-100 border-base-300 w-full border p-4 shadow-md">
					<div class="flex items-center space-x-4">
						<!-- Avatar or status indicator -->
						<div class="relative">
							<div class="inline-grid *:[grid-area:1/1]">
								<div
									class="status status-xl animate-ping transition-transform duration-100"
									style="transform: scale({voiceIndicator})"
								></div>
								<div
									class="status status-xl"
									style="background: #{userId}; color: #{userId}; transform: scale({voiceIndicator})"
								></div>
							</div>
						</div>
						<!-- Participant info -->
						<div class="flex-1">
							<div class="text-base font-bold">
								<span class="text-sm"><b>{nickname}{adminModeOn ? '*' : ''}</b></span>
							</div>
							<div class="text-sm text-gray-500">
								{#if ENABLE_AUDIO}
									<label class="swap swap-flip">
										<input type="checkbox" bind:checked={microphone} class="hidden" />
										<div class="swap-on">
											<Fa icon={faMicrophone} />
										</div>
										<div class="swap-off text-red-500">
											<Fa icon={faMicrophoneSlash} />
										</div>
									</label>
								{/if}
							</div>
						</div>
					</div>
				</div>
				{#each Object.entries(others) as [colorHex, other]}
					<div class="card bg-base-100 border-base-300 w-full border p-4 shadow-md">
						<div class="flex items-center space-x-4">
							<!-- Avatar or status indicator -->
							<div class="relative">
								<div class="inline-grid *:[grid-area:1/1]">
									<div
										class="status status-xl animate-ping transition-transform duration-100"
										style="transform: scale({otherVoices[colorHex]})"
									></div>
									<div
										class="status status-xl"
										style="background: #{colorHex}; color: #{colorHex}; transform: scale({otherVoices[
											colorHex
										]})"
									></div>
								</div>
							</div>
							<!-- Participant info -->
							<div class="flex-1">
								<div class="text-base font-bold">
									{(other as any).nickname}
								</div>
								<div class="text-sm text-gray-500">
									{#if ENABLE_AUDIO}
										<label
											class="swap swap-flip cursor-default"
											class:swap-active={(other as any).microphone}
										>
											<div class="swap-on">
												<Fa icon={faMicrophone} />
											</div>
											<div class="swap-off text-red-500">
												<Fa icon={faMicrophoneSlash} />
											</div>
										</label>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
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
					class="block max-h-300 overflow-y-auto"
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
	table {
		table-layout: fixed;
		box-shadow:
			0 2px 5px 0 rgba(0, 0, 0, 0.16),
			0 2px 10px 0 rgba(0, 0, 0, 0.12);
	}
</style>
