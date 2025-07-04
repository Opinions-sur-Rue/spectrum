<script lang="ts">
	/* eslint-disable */
	// @ts-nocheck
	/* eslint svelte/no-at-html-tags: "off" */

	import Header from '$lib/components/Header.svelte';
	import {
		faCirclePlus,
		faClock,
		faComments,
		faCopy,
		faExclamation,
		faEye,
		faEyeSlash,
		faLock,
		faMapPin,
		faMicrophone,
		faMicrophoneSlash,
		faPalette,
		faPaperPlane,
		faPerson,
		faPersonWalkingArrowRight,
		faPlayCircle,
		faRightFromBracket,
		faRotateLeft,
		faSatelliteDish,
		faStop,
		faTowerBroadcast,
		faUserSlash,
		faVolumeHigh,
		faVolumeMute
	} from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';
	import { page } from '$app/state';
	import { getUserId } from '$lib/authentication/userId';
	import CreateSpectrumModal from '$lib/components/CreateSpectrumModal.svelte';
	import JoinSpectrumModal from '$lib/components/JoinSpectrumModal.svelte';
	import ConnectLiveModal from '$lib/components/ConnectLiveModal.svelte';
	import { ENABLE_AUDIO, HEADER_TITLE, LOGO_URL, LOGO_WIDTH, PUBLIC_URL } from '$lib/env';
	import { startWebsocket } from '$lib/spectrum/websocket';
	import { Canvas, Circle, FabricText, Group, loadSVGFromURL, Rect, util } from 'fabric';
	import { onMount, tick } from 'svelte';
	import { copy } from 'svelte-copy';
	import { capitalize, lerp, pointInPolygon } from '$lib/utils';
	import Peer from 'peerjs';
	import * as pkg from 'peerjs';
	import EmojiBurst from '$lib/components/EmojiBurst.svelte';
	import InputFlex from '$lib/components/InputFlex.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getContext } from 'svelte';
	import { notify } from '$lib/utils/notify';

	let { id: spectrumId }: { id: string | undefined } = $props();

	let streamerModeLayout = getContext<any>('streamerMode');

	const opinions = {
		stronglyAgree: m.opinion_strongly_agree(),
		agree: m.opinion_agree(),
		slightlyAgree: m.opinion_slightly_agree(),
		neutral: m.opinion_neutral(),
		slightlyDisagree: m.opinion_slightly_disagree(),
		disagree: m.opinion_disagree(),
		stronglyDisagree: m.opinion_strongly_disagree(),
		indifferent: m.opinion_indifferent(),
		notReplied: m.opinion_not_replied()
	};
	type OpinionKey = keyof typeof opinions;
	let currentOpinion: string = 'notReplied';
	let previousOpinion: string = 'notReplied';

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

	interface Log {
		type: string;
		message: string;
	}

	let logs: Log[] = $state([]);

	let myPellet: any = $state();
	let moving = false;
	const cells: any[] = [];
	const cellsPoints: any[] = [];
	const others: any = $state({});

	let claim: string = $state('');
	let scale: number;

	let tbodyRef: any; // Reference to tbody

	let localStream: MediaStream | undefined = $state();
	let peer: Peer;
	let peerId: string | undefined = $state();
	let peerConnected = $state(false);
	const connections = new Map<string, MediaStream>();
	let microphone: boolean = $state(false);

	function validateOpinion(otherUserId: string) {
		const target = others[otherUserId].pellet;
		if (!target) return;

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];

			if (pointInPolygon(cellsPoints[i], [target.left, target.top])) {
				if (cell.id != 'notReplied') {
					log(
						m.log_opinion({
							name: others[otherUserId].nickname,
							opinion: opinions[cell.id as OpinionKey]
						}),
						'event'
					);
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
		if (ENABLE_AUDIO && peerId && spectrumId) {
			if (microphone) {
				localStream?.getTracks().forEach((track) => (track.enabled = true));
				rpc('unmutedmymicrophone');
			} else {
				localStream?.getTracks().forEach((track) => (track.enabled = false));
				rpc('mutedmymicrophone');
			}
		}
	});

	$effect(() => {
		if (ENABLE_AUDIO) {
			if (spectrumId && peerId && userId && localStream) {
				rpc('myvoicechatid', peerId);
				rpc('mutedmymicrophone');
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
	let voiceActivated: boolean = $state(false);
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
		console.log('ACTIVATION DU MICRO');
		try {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});

			const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

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
			voiceActivated = true;
		} catch (err) {
			console.error('Error accessing microphone:', err);
		}
	}

	function playAudio(voiceId: string, stream: MediaStream) {
		console.log('Playing audio for voiceId:', voiceId);
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

		const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

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

			if (others[otherId!]) {
				if (average > 20) {
					others[otherId!].averageVoice = average;
				} else {
					others[otherId!].averageVoice = 0;
				}
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

			console.log('RECEIVED CALL FROM', call.peer);
			call.on('stream', (remoteStream) => {
				playAudio(call.peer, remoteStream);

				if (connections.has(call.peer)) {
					// kill previous connection
					connections
						.get(call.peer)
						?.getTracks()
						.forEach((element) => element.stop());
				}

				connections.set(call.peer, remoteStream);
			});
		});
	}

	onMount(() => {
		connectToPeer();
		currentOpinion = 'notReplied';

		spectrumId = page.params?.id;
		websocket = startWebsocket(signIn, parseCommand, connectionLost);

		// Prepare Both Canvas
		myCanvas = drawCanvas('spectrum');

		myCanvas.on({
			'object:moving': function () {
				moving = true;
			},
			'object:modified': function () {
				moving = false;

				if (currentOpinion != 'notReplied' && currentOpinion != previousOpinion) {
					log(m.log_your_opinion({ opinion: opinions[currentOpinion as OpinionKey] }), 'event');
					previousOpinion = currentOpinion;
				}
			}
		});

		// @ts-ignore
		loadSVGFromURL(m.file_spectrum()).then(({ objects, options }) => {
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
		log(m.log_joined_spectrum({ name: nickname }), 'join');
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
			others[otherUserId] = {
				pellet:
					coords && !isNaN(coords.x) && !isNaN(coords.y)
						? initOtherPellet(otherUserId, otherNickname)
						: null,
				target: coords && !isNaN(coords.x) && !isNaN(coords.y) ? coords : undefined,
				nickname: otherNickname,
				microphone: false,
				muted: false
			};
		} else if (coords && !isNaN(coords.x) && !isNaN(coords.y)) {
			// known user
			others[otherUserId].target = coords;
			if (others[otherUserId].nickname != otherNickname)
				others[otherUserId].nickname = otherNickname;
			if (!others[otherUserId].pellet)
				others[otherUserId].pellet = initOtherPellet(otherUserId, otherNickname);
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
			delete others[otherUserId].pellet;
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
	let handAnimation = $state(false);
	let handUsername = $state('');
	let emoji: string = $state('');

	function sendEmoji(emojiIndex: number) {
		const emojis = ['😜', '🤔', '😵', '🤯', '🫣', '🛟', '🦝'];
		rpc('emoji', emojis[emojiIndex]);
	}

	function raiseHand() {
		rpc('emoji', '🤚');
	}

	function rpc(procedure: string, ...args: string[]) {
		const json = JSON.stringify({
			procedure: procedure,
			arguments: args
		});

		websocket.send(json);
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
			rpc(
				'myposition',
				`${Math.round(myPellet.left / scale)},${Math.round(myPellet.top / scale)}`,
				nickname ?? ''
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
		rpc('signin', getUserId());
	}

	let isHoveringHistory = false;

	function log(message: string, type?: string) {
		const now = new Date();
		const formattedDate = now.toLocaleString('fr-FR');
		logs.push({ message: `[${formattedDate}] ${message}`, type: type ?? 'message' });
		logs = logs;
		scrollToBottom();
	}

	let claimFocus = false;

	function parseCoords(coords: string): { x: number; y: number } | null {
		if (!coords) return null;
		const parts = coords.split(',');
		if (parts.length !== 2) return null;
		const x = parseInt(parts[0]);
		const y = parseInt(parts[1]);
		if (isNaN(x) || isNaN(y)) return null;
		return { x, y };
	}

	let liveVotes = new Map<string, number>();

	function parseLiveSpectrum(liveUserId: string, liveSpectrum: string): { x: number; y: number } {
		const parts = liveSpectrum.split(' ');
		const vote = parseInt(parts[1]);

		liveVotes.set(liveUserId, vote);
		const sum = Array.from(liveVotes.values()).reduce((acc, val) => acc + val, 0);
		const average = sum / liveVotes.size;

		const averageVote = Math.round(average);

		switch (averageVote) {
			case 3:
				return { x: 98, y: 399 };
			case 2:
				return { x: 157, y: 251 };
			case 1:
				return { x: 292, y: 127 };
			case 0:
				return { x: 475, y: 78 };
			case -1:
				return { x: 659, y: 123 };
			case -2:
				return { x: 771, y: 250 };
			case -3:
				return { x: 832, y: 408 };
		}

		return { x: 467, y: 424 };
	}

	function parseCommand(line: string) {
		if (!listenning) return;

		/*const re = new RegExp(
			/^(ack|nack|update|claim|spectrum|newposition|userleft|madeadmin|receive|voicechat|microphonemute|microphoneunmute)(\s+([0-9a-f]*))?(\s+([0-9N-]+,[0-9A-]+))?(\s+(.+))?$/gu
		);*/
		const rpc = JSON.parse(line) as { procedure: string; arguments: string[] };

		if (rpc.procedure) {
			const command = rpc.procedure;

			if (command == 'ack') {
				if (rpc.arguments[0] == 'signin') {
					if (!initialized) initialized = true;
				}
			} else if (command == 'nack') {
				// TODO: translate
				notify.error('Désolé, erreur reçue: ' + rpc.arguments[0]);
			} else if (command == 'update') {
				const otherUserId = rpc.arguments[0];
				const coords = parseCoords(rpc.arguments[1]);
				const otherNickname = rpc.arguments[2];
				if (otherUserId != userId) updatePellet(otherUserId, coords, otherNickname);
			} /*else if (command == 'joined') {
				const otherUserId = rpc.arguments[0];
				const otherNickname = rpc.arguments[1];
				if (otherUserId != userId) initOtherPellet(otherUserId, otherNickname);
			} */ else if (command == 'userleft') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					log(m.log_left_spectrum({ name: others[otherUserId].nickname }), 'leave');
					deletePellet(otherUserId);
				} else {
					log(m.log_you_left_spectrum(), 'leave');
					notify.error(m.log_you_left_spectrum());
					leaveSpectrum();
				}
			} else if (command == 'receive') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					notify.info(others[otherUserId].nickname + ' a envoyé : ' + rpc.arguments[1], 5000);
					log(
						m.log_emoji_received({ name: others[otherUserId].nickname, emoji: rpc.arguments[1] }),
						'event'
					);
				} else {
					log(m.log_emoji_sent({ emoji: rpc.arguments[1] }), 'event');
				}
				trigger = false;
				handAnimation = false;
				handUsername = '';
				emoji = rpc.arguments[1];

				if (emoji === '🤚') {
					handAnimation = true;
					handUsername = otherUserId != userId ? others[otherUserId].nickname : nickname;
				}

				requestAnimationFrame(() => (trigger = true)); // retrigger animation
			} else if (command == 'madeadmin') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					deletePellet(otherUserId, true);
					log(m.log_made_admin({ name: others[otherUserId].nickname }), 'event');
				} else {
					adminModeOn = true;
					myCanvas.remove(myPellet);
					myCanvas.renderAll();
					myPellet = null;
					log(m.log_you_been_made_admin(), 'event');
				}
			} else if (command == 'newposition') {
				if (!myPellet) {
					initPellet();
				}

				const coords = parseCoords(rpc.arguments[0]);

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
					receivedClaim(rpc.arguments[0]);

					clearTimeout(updateClaimLog);
					updateClaimLog = setTimeout(() => {
						log(m.log_claim({ claim }), 'claim');
					}, 3000);
				}
			} else if (command == 'voicechat') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					const voiceId = rpc.arguments[1].toString();
					others[otherUserId].voiceId = voiceId;
					if (localStream && peerId) attemptCallWithLimit(peer, voiceId, localStream, 10);
				} else {
					if (!localStream)
						getAudioStream().then(() => {
							if (peerId) {
								for (const key in others) {
									if (others[key].voiceId) {
										attemptCallWithLimit(peer, others[key].voiceId, localStream, 10);
									}
								}
							}
						});
				}
			} else if (command == 'microphonemuted') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					others[otherUserId].microphone = false;
				}
			} else if (command == 'listenning') {
				liveListenning = true;
				liveChannel = rpc.arguments[0];
				log(m.log_spectrum_connected(liveChannel));
			} else if (command == 'microphoneunmuted') {
				const otherUserId = rpc.arguments[0];
				if (otherUserId != userId) {
					others[otherUserId].microphone = true;
				}
			} else if (command == 'spectrum') {
				showJoinModal = false;
				userId = rpc.arguments[0];
				nickname = rpc.arguments[2];
				if (rpc.arguments[3] == 'true') {
					adminModeOn = true;
				}
				joinedSpectrum(rpc.arguments[1]);

				log(m.log_you_joined_spectrum(), 'join');
			} else if (command == 'liveusermessage') {
				let otherUserId;
				switch (liveChannel) {
					case 'youtube':
						otherUserId = 'ff0000';
						break;
					case 'tiktok':
						otherUserId = '000000';
						break;
					case 'twitch':
						otherUserId = '9146ff';
						break;
					default:
						console.error('missing liveChannel');
						return;
				}
				const coords = parseLiveSpectrum(rpc.arguments[0], rpc.arguments[3]);
				const otherNickname = capitalize(liveChannel ?? '');
				if (otherUserId != userId) updatePellet(otherUserId, coords, otherNickname);
			} else if (command == 'chatmessage') {
				const otherUserId = rpc.arguments[0];
				const message = rpc.arguments[1];
				if (otherUserId != userId) log(`${others[otherUserId].nickname}: ${message}`);
				else log(`${nickname}: ${message}`);
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
			//connections.set(targetId, peer.call(targetId, localStream));
			peer.call(targetId, localStream);
		} else if (attempt <= maxRetries) {
			setTimeout(() => {
				attemptCallWithLimit(peer, targetId, localStream, maxRetries, attempt + 1);
			}, 1000); // Retry after 1 second
		} else {
			console.error(`Failed to establish peer connection to ${targetId} after maximum retries.`);
		}
	}

	let updateClaimLog: number | undefined;
	let previousClaim: string | undefined;

	function connectionLost() {
		notify.error(m.cannot_connect());
	}

	function resetPositions() {
		rpc('resetpositions');
	}

	function onCreateSpectrum(nickname: string, initialClaim?: string) {
		listenning = true;
		claim = initialClaim ?? '';
		rpc('startspectrum', nickname);
		showCreateModal = false;
		adminModeOn = true;
		rpc('claim', claim);
	}

	function onJoinSpectrum(spectrumId: string, nickname: string) {
		listenning = true;
		rpc('joinspectrum', spectrumId, nickname);
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

		rpc('makeadmin', id);
	}

	function kick(id: string) {
		if (!adminModeOn) return;

		rpc('kick', id);
	}

	let showSpectrumId = $state(false);

	let showJoinModal = $state(false);
	let chatMessage = $state('');
	function sendChatMessage() {
		rpc('sendchatmessage', chatMessage);
		chatMessage = '';
	}

	function toggleJoinModal() {
		showJoinModal = !showJoinModal;
	}

	let showCreateModal = $state(false);
	function toggleCreateModal() {
		showCreateModal = !showCreateModal;
	}

	let showConnectLiveModal = $state(false);
	function toggleConnectLiveModal() {
		showConnectLiveModal = !showConnectLiveModal;
	}

	let liveChannel: string | undefined = $state();
	let liveListenning: boolean = $state(false);

	function onConnectLive(channel: string, liveId: string, secret: string) {
		rpc('listen', channel, liveId, secret);
		liveListenning = false;
		liveChannel = channel;
		toggleConnectLiveModal();
	}

	function leaveSpectrum() {
		listenning = false;
		rpc('leavespectrum');
		spectrumId = undefined;
		adminModeOn = false;
		myCanvas.remove(myPellet);
		for (const key in others) {
			if (others[key].pellet) myCanvas.remove(others[key].pellet);
			delete others[key];
		}
		myCanvas.renderAll();
		peer.disconnect();
		connections.forEach((stream) => stream.getTracks().forEach((t) => t.stop()));
	}

	const copied = () => {
		notify.success(m.notify_link_copied());
	};

	let streamerMode = $state(false);

	function toggleMicrophone(event: MouseEvent & { currentTarget: EventTarget & HTMLLabelElement }) {
		microphone = !microphone;

		// Open microphone for first time, will trigger permission etc, and then call everybody we knew who had voiceId
		if (!localStream && microphone) {
			getAudioStream().then(() => {
				for (const key in others) {
					if (others[key].voiceId) attemptCallWithLimit(peer, others[key].voiceId, localStream, 10);
				}
			});
		}
	}

	function toggleMute(userId: string) {
		if (!ENABLE_AUDIO) return;

		if (others[userId].muted) {
			connections
				.get(others[userId].voiceId)
				?.getTracks()
				.forEach((track) => (track.enabled = true));
			others[userId].muted = false;
		} else {
			connections
				.get(others[userId].voiceId)
				?.getTracks()
				.forEach((track) => (track.enabled = false));
			others[userId].muted = true;
		}
	}
</script>

<CreateSpectrumModal bind:toggle={showCreateModal} onSubmit={onCreateSpectrum} />
<JoinSpectrumModal bind:toggle={showJoinModal} onSubmit={onJoinSpectrum} {spectrumId} />
<ConnectLiveModal bind:toggle={showConnectLiveModal} onSubmit={onConnectLive} />
<EmojiBurst {emoji} {trigger} {handAnimation} {handUsername} />

{#if !streamerMode}
	<Header subtitle={m.subtitle()} logo={LOGO_URL} logoWidth={LOGO_WIDTH} title={HEADER_TITLE}>
		<div class="items-left justify-left mt-8 ml-0 flex flex-wrap gap-4 font-mono">
			<span class="px-4 py-2">
				<div class="inline-grid *:[grid-area:1/1]">
					<div class={spectrumId ? 'status status-success' : 'status status-error'}></div>
				</div>
				{#if spectrumId}
					<span class="inline-flex items-center">
						{m.spectrum_in_progress()} &mdash; {m.id()}=<b
							>{showSpectrumId ? spectrumId : 'OSR-****'}</b
						>
						<div
							class="tooltip inline-block align-baseline"
							data-tip={showSpectrumId ? m.hide_id() : m.show_id()}
						>
							<label class="swap">
								<input type="checkbox" class="hidden" bind:checked={showSpectrumId} />
								<div class="swap-on btn btn-ghost btn-circle"><Fa icon={faEye} /></div>
								<div class="swap-off btn btn-ghost btn-circle"><Fa icon={faEyeSlash} /></div>
							</label>
						</div>
					</span>
				{:else}
					{m.no_spectrum()}
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
					<Fa icon={faCopy} />
					{m.copy_link()}
				</button>
				<button
					onclick={() => {
						streamerMode = true;
						streamerModeLayout.activateStreamerMode();
					}}
					class="btn btn-info rounded-lg px-4 py-2"
					><Fa icon={faSatelliteDish} /> {m.streamer_mode()}</button
				>
				<button onclick={leaveSpectrum} class="btn btn-warning float-right rounded-lg px-4 py-2"
					><Fa icon={faPersonWalkingArrowRight} /> {m.leave_spectrum()}</button
				>
			{:else}
				<button onclick={toggleCreateModal} class="btn btn-warning rounded-lg px-4 py-2"
					><Fa icon={faPlayCircle} /> {m.start_spectrum()}</button
				>
				<button onclick={toggleJoinModal} class="btn btn-success rounded-lg px-4 py-2"
					><Fa icon={faRightFromBracket} /> {m.join_spectrum()}</button
				>
			{/if}
		</div>
	</Header>
{:else}
	<div class="fixed top-5 right-[2rem] z-1000">
		<div class="tooltip tooltip-left" data-tip="Quitter mode streamer">
			<button
				onclick={() => {
					streamerMode = false;
					streamerModeLayout.deactivateStreamerMode();
				}}
				class="btn btn-info btn-circle"><Fa icon={faSatelliteDish} /></button
			>
		</div>
	</div>
{/if}

<div
	class="relative mt-8 grid h-full grid-cols-1 justify-items-start gap-4 md:h-[50vh] md:grid-cols-[2fr_1fr]"
>
	<div class="flex h-max w-full">
		<div class="card bg-base-100 h-max w-full shadow-sm" bind:clientWidth={canvasWidth}>
			<header class="w-full p-0 font-mono">
				<label class="floating-label">
					<InputFlex
						name="claim"
						placeholder={m.claim()}
						readonly={!adminModeOn}
						bind:value={claim}
						onfocusin={() => {
							claimFocus = true;
							previousClaim = claim;
						}}
						onfocusout={() => {
							claimFocus = false;
							if (claim != previousClaim) log(m.log_claim({ claim }), 'claim');
						}}
						oninput={() => {
							if (adminModeOn) {
								rpc('claim', claim);
							}
						}}
						minFontSize={12}
						maxFontSize={24}
					/>
					<span class="font-bold"><Fa icon={faMapPin} /> {m.claim()}</span>
				</label>
			</header>

			<div class="border-t p-0">
				<canvas class="m-auto" id="spectrum"></canvas>
			</div>

			<footer class="flex flex-wrap items-center justify-center gap-4" class:p-4={spectrumId}>
				{#if adminModeOn}
					<div>
						<button class="btn btn-neutral rounded-lg px-4 py-2 font-mono" onclick={resetPositions}>
							<Fa icon={faRotateLeft} /><span class="hidden lg:!inline-block">
								{m.reset_positions()}</span
							></button
						>

						<button
							class="btn btn-neutral rounded-lg px-4 py-2 font-mono"
							class:btn-disabled={myPellet}
							onclick={initPellet}
							><Fa icon={faCirclePlus} /><span class="hidden lg:!inline-block">
								{m.create_pellet()}</span
							></button
						>

						<button class="btn btn-neutral btn-disabled rounded-lg px-4 py-2 font-mono"
							><Fa icon={faStop} /><span class="hidden lg:!inline-block">
								{m.stop_spectrum()}</span
							></button
						>
						{#if liveChannel && liveListenning}
							<button
								class="btn btn-error rounded-lg px-4 py-2 font-mono"
								onclick={() => {
									rpc('disconnect');
									liveChannel = undefined;
								}}
								><Fa icon={faTowerBroadcast} /><span class="hidden lg:!inline-block">
									{m.disconnect_live()}</span
								></button
							>
						{:else if liveChannel}
							<button class="btn btn-error rounded-lg px-4 py-2 font-mono"
								><span class="loading loading-spinner loading-xs"></span><span
									class="hidden lg:!inline-block"
								>
									{m.connecting_live()}</span
								></button
							>
						{:else}
							<button
								class="btn btn-error rounded-lg px-4 py-2 font-mono"
								onclick={toggleConnectLiveModal}
								><Fa icon={faTowerBroadcast} /><span class="hidden lg:!inline-block">
									{m.connect_live()}</span
								></button
							>
						{/if}
					</div>
				{/if}

				{#if spectrumId}
					<div>
						<div
							class="dropdown dropdown-top dropdown-center"
							style="font-style: normal; font-family: 'Segoe UI', 'Noto Color Emoji', 'Apple Color Emoji', 'Emoji', sans-serif;"
						>
							<div tabindex="0" role="button" class="btn btn-warning rounded-lg font-mono">
								😀 {m.emoji()}
							</div>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<ul
								tabindex="0"
								class="dropdown-content menu bg-base-100 rounded-box z-1 w-12 p-2 shadow-sm"
							>
								<li><button onclick={() => sendEmoji(0)}>😜</button></li>
								<li><button onclick={() => sendEmoji(1)}>🤔</button></li>
								<li><button onclick={() => sendEmoji(2)}>😵</button></li>
								<li><button onclick={() => sendEmoji(3)}>🤯</button></li>
								<li><button onclick={() => sendEmoji(4)}>🫣</button></li>
								<li><button onclick={() => sendEmoji(5)}>🛟</button></li>
								<li><button onclick={() => sendEmoji(6)}>🦝</button></li>
							</ul>
						</div>
						<button class="btn btn-info rounded-lg px-4 py-2 font-mono" onclick={() => raiseHand()}
							>🤚<span class="hidden lg:!inline-block"> {m.raise_hand()}</span></button
						>
					</div>
				{/if}
			</footer>
		</div>
	</div>

	<div class="flex min-h-0 flex-col overflow-hidden">
		{#if !streamerMode}
			<div
				class="card bg-base-100 card-border border-base-300 from-base-content/5 mb-4 flex-none bg-linear-to-bl to-50% font-mono shadow-sm"
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
							<th><Fa icon={faPerson} /> {m.participants()}</th>
							<th><Fa icon={faExclamation} /> {m.actions()}</th>
						</tr>
						{#if spectrumId}
							<tr>
								<td>
									<div class="inline-grid *:[grid-area:1/1]">
										<div
											class="status status-lg animate-ping transition-transform duration-100"
											class:hidden={!microphone}
											style="transform: scale({voiceIndicator})"
										></div>
										<div
											class="status status-lg"
											style="background: #{userId}; color: #{userId}; transform: scale({voiceIndicator})"
										></div>
									</div>
								</td>
								<td>
									<span class="text-sm"
										><b>{nickname}{adminModeOn ? '*' : ''}</b> ({m.yourself()})</span
									>
								</td>
								<td>
									{#if ENABLE_AUDIO}
										<div
											class="tooltip"
											data-tip={microphone ? m.mute_microphone() : m.unmute_microphone()}
										>
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<label
												class="swap indicator"
												onclick={toggleMicrophone}
												class:swap-active={microphone && peerConnected}
											>
												<div class="swap-on btn btn-ghost btn-square rounded-xl">
													<Fa icon={faMicrophone} />
												</div>
												<div
													class="swap-off btn btn-square rounded-xl border-0 bg-red-500/20 text-red-500"
												>
													<Fa icon={faMicrophoneSlash} />
												</div>
												{#if !peerConnected || !localStream}
													<span class="badge badge-xs badge-warning indicator-item"></span>
												{/if}
											</label>
										</div>
									{/if}
								</td>
							</tr>
						{/if}
						{#each Object.entries(others) as [colorHex, other]}
							<tr class="even:bg-base-100">
								<td>
									<div class="inline-grid *:[grid-area:1/1]">
										<div
											class="status status-lg animate-ping transition-transform duration-100"
											class:hidden={!other.microphone}
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
									<div class="tooltip" data-tip={m.mute()}>
										<button
											class="btn btn-square rounded-xl border-0 bg-yellow-500/20 text-yellow-500"
											onclick={() => {
												if (other.microphone) toggleMute(colorHex);
											}}
										>
											{#if !other.muted}
												<Fa icon={faVolumeHigh} />
											{:else}
												<Fa icon={faVolumeMute} />
											{/if}</button
										>
									</div>
									{#if adminModeOn}
										<div class="tooltip" data-tip={m.kick_participant()}>
											<button
												class="btn btn-square rounded-xl border-0 bg-orange-500/20 text-orange-500"
												onclick={() => {
													kick(colorHex);
												}}><Fa icon={faUserSlash} /></button
											>
										</div>
										<div class="tooltip" data-tip={m.make_admin()}>
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
								<span class="truncate text-sm"><b>{nickname}{adminModeOn ? '*' : ''}</b></span>
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
								<div class="truncate text-base font-bold">
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
			class="card bg-base-100 card-border border-base-300 from-base-content/5 min-h-0 flex-1 overflow-y-auto bg-linear-to-bl to-50% font-mono !shadow-sm"
		>
			<div class="card-title p-4" style="border-bottom: 1px solid var(--color-base-300)">
				<Fa icon={faComments} />
				{m.chat()}
			</div>
			<div class="flex h-full flex-col overflow-hidden">
				<div
					class="max-h-[50vh] min-h-0 w-full flex-1 overflow-y-auto md:max-h-full"
					role="listbox"
					tabindex="0"
					bind:this={tbodyRef}
					onmouseenter={() => (isHoveringHistory = true)}
					onmouseleave={() => (isHoveringHistory = false)}
				>
					{#each logs as log, i}
						{@const regex = /^\[([^\]]+)\]\s*(.*)$/}
						{@const match = log.message.match(regex)}
						<div class="even:bg-base-100 px-4 py-1">
							<div class="w-full">
								<span class="tooltip tooltip-right" data-tip={match?.[1]}
									><Fa icon={faClock} /></span
								>
								<span
									class="text-sm"
									class:text-black-800={log.type === 'message' || log.type === 'event'}
									class:text-green-800={log.type === 'join'}
									class:text-red-800={log.type === 'leave'}
									class:text-orange-800={log.type === 'claim'}>{match?.[2]}</span
								>
							</div>
						</div>
					{/each}
				</div>
			</div>
			<div class="join flex-none">
				<InputFlex
					placeholder={m.send_chat()}
					bind:value={chatMessage}
					onkeydown={(e) => {
						if (e.key === 'Enter') sendChatMessage();
					}}
					minFontSize={8}
					maxFontSize={12}
					nofocus
				/>
				<button class="btn btn-xl join-item" onclick={sendChatMessage}
					><Fa icon={faPaperPlane} /></button
				>
			</div>
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

	.swap-active {
		opacity: 1;
	}
</style>
