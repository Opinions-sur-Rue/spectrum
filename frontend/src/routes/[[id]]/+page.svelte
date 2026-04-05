<script lang="ts">
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
		faPersonArrowUpFromLine,
		faPersonWalkingArrowRight,
		faPlayCircle,
		faRightFromBracket,
		faRotateLeft,
		faSatelliteDish,
		faStop,
		faTowerBroadcast,
		faUserSlash,
		faVolumeHigh,
		faVolumeLow,
		faVolumeOff,
		faVolumeXmark
	} from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';
	import { page } from '$app/state';
	import { getUserId } from '$lib/authentication/userId';
	import CreateSpectrumModal from '$lib/components/CreateSpectrumModal.svelte';
	import JoinSpectrumModal from '$lib/components/JoinSpectrumModal.svelte';
	import ConnectLiveModal from '$lib/components/ConnectLiveModal.svelte';
	import { HEADER_TITLE, LOGO_URL, LOGO_WIDTH, PUBLIC_URL } from '$lib/env';
	import {
		startWebsocket,
		wsState,
		registerHandler,
		unregisterHandler
	} from '$lib/spectrum/websocket.svelte';
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { copy } from 'svelte-copy';
	import { capitalize, stringToColorHex } from '$lib/utils';
	import * as voice from '$lib/voice/index.svelte';
	import { room, joinRoom, leaveRoom, type Participant } from '$lib/spectrum/room.svelte';
	import EmojiBurst from '$lib/components/EmojiBurst.svelte';
	import InputFlex from '$lib/components/InputFlex.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { notify } from '$lib/utils/notify';
	import {
		requestAudioPermission,
		startAudioForegroundService,
		stopAudioForegroundService
	} from '$lib/native/audio-service';
	import AddLiveUserParticipantModal from '$lib/components/AddLiveUserParticipantModal.svelte';
	import { canvasManager, originalWidth } from '$lib/canvas/manager.svelte';
	import type { LiveUser } from '$lib/social';

	// eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
	let { id: spectrumId }: { id: string | undefined } = $props();

	// Keep room store in sync with the SvelteKit route param.
	// spectrumId (prop) is the source of truth for the URL;
	// room.spectrumId is used by other modules (voice callbacks etc.)
	$effect(() => {
		room.spectrumId = spectrumId;
	});

	let canvasWidth: number = $state(originalWidth);

	let websocket: WebSocket;

	// Expose myPellet from manager so the template can check its presence
	let myPellet = $derived(canvasManager.myPellet);

	let tbodyRef: HTMLDivElement | undefined; // Reference to tbody

	$effect(() => {
		if (canvasWidth) {
			const scale = canvasWidth / originalWidth;
			canvasManager.setScale(scale, canvasWidth);
		}
	});

	$effect(() => {
		if (voice.voiceState.peerId && spectrumId) {
			if (voice.voiceState.microphone) {
				voice.unmuteMicrophone();
				rpc('unmutedmymicrophone');
			} else {
				voice.muteMicrophone();
				rpc('mutedmymicrophone');
			}
		}
	});

	$effect(() => {
		if (spectrumId && voice.voiceState.peerId && room.userId) {
			rpc('myvoicechatid', voice.voiceState.peerId);
			// Call all known peers as safety net (handles race conditions on first load)
			// untrack prevents this effect from re-running on every others mutation
			untrack(() => {
				for (const key in room.others) {
					if (room.others[key].voiceId) {
						voice.callPeerWithLimit(room.others[key].voiceId!);
					}
				}
			});
		}
	});

	async function scrollToBottom() {
		await tick(); // Wait for UI to update
		if (tbodyRef && !isHoveringHistory) {
			tbodyRef.scrollTop = tbodyRef.scrollHeight;
		}
	}

	let voiceIndicator = $derived(1 + voice.voiceState.averageVoice / 100);
	let otherVoices = $derived.by(() => {
		const voices: Record<string, number> = {};
		for (const [key, other] of Object.entries(room.others)) {
			voices[key] = 1 + ((other as Participant).averageVoice ?? 0) / 100;
		}
		return voices;
	});

	onMount(() => {
		voice.connect();
		voice.setCallbacks({
			resolveVoiceId: (voiceId) => {
				for (const [key, other] of Object.entries(room.others)) {
					if ((other as Participant).voiceId === voiceId) return key;
				}
				return undefined;
			},
			onAudio: (uid, audio) => {
				if (room.others[uid]) room.others[uid].audio = audio;
			},
			onAverageVoice: (uid, avg) => {
				if (room.others[uid]) room.others[uid].averageVoice = avg;
			},
			onStream: (uid, audio) => {
				if (room.others[uid]) room.others[uid].audio = audio;
			}
		});
		spectrumId = page.params?.id;
		// RPC handlers — always active
		registerHandler('ack', (args) => {
			if (args[0] == 'signin') {
				if (!room.initialized) room.initialized = true;
				if (wasReconnecting) {
					wasReconnecting = false;
					log('✓ Reconnected', 'join');
					if (savedRejoinSpectrumId) {
						ejectionDetectTimer = setTimeout(() => {
							showEjectedBanner = true;
						}, 2000);
					}
				}
			}
		});
		registerHandler('nack', (args) => {
			joiningSpectrum = false;
			notify.error(m.error_nack({ error: args[0] }));
		});
		registerHandler('spectrum', (args) => {
			joiningSpectrum = false;
			if (ejectionDetectTimer) {
				clearTimeout(ejectionDetectTimer);
				ejectionDetectTimer = undefined;
			}
			savedRejoinSpectrumId = undefined;
			savedRejoinNickname = undefined;
			showEjectedBanner = false;
			showJoinModal = false;
			room.showNeutralCircle = args[4] !== 'false';
			joinRoom(args[1], args[0], args[2], args[3] == 'true');
			joinedSpectrum(args[1]);
			log(m.log_you_joined_spectrum(), 'join');
		});

		// RPC handlers — only active while listening
		registerHandler('update', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			const coords = parseCoords(args[1]);
			const otherNickname = args[2];
			if (otherUserId != room.userId)
				canvasManager.updatePellet(otherUserId, coords, otherNickname);
		});
		registerHandler('userleft', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId) {
				log(m.log_left_spectrum({ name: room.others[otherUserId].nickname }), 'leave');
				canvasManager.deletePellet(otherUserId);
			} else {
				log(m.log_you_left_spectrum(), 'leave');
				notify.error(m.log_you_left_spectrum());
				leaveSpectrum();
			}
		});
		registerHandler('receive', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId) {
				notify.info(room.others[otherUserId].nickname + ' a envoyé : ' + args[1], 5000);
				log(
					m.log_emoji_received({
						name: room.others[otherUserId].nickname,
						emoji: args[1]
					}),
					'event'
				);
			} else {
				log(m.log_emoji_sent({ emoji: args[1] }), 'event');
			}
			trigger = false;
			handAnimation = false;
			lowerAnimation = false;
			handUsername = '';
			emoji = args[1];
			if (emoji === '🤚') {
				handAnimation = true;
				handUsername =
					otherUserId != room.userId ? room.others[otherUserId].nickname : (room.nickname ?? '');
				if (otherUserId !== room.userId && room.others[otherUserId]) {
					room.others[otherUserId].handRaised = true;
				}
			}
			requestAnimationFrame(() => (trigger = true)); // retrigger animation
		});
		registerHandler('handlowered', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (room.others[otherUserId]) {
				room.others[otherUserId].handRaised = false;
			}
		});
		registerHandler('madeadmin', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId) {
				canvasManager.deletePellet(otherUserId, true);
				log(m.log_made_admin({ name: room.others[otherUserId].nickname }), 'event');
			} else {
				room.adminModeOn = true;
				canvasManager.removeMyPellet();
				log(m.log_you_been_made_admin(), 'event');
			}
		});
		registerHandler('newposition', (args) => {
			if (!room.listening) return;
			if (!canvasManager.myPellet) initPellet();
			const coords = parseCoords(args[0]);
			if (canvasManager.myPellet && coords) {
				canvasManager.resetMyPelletPosition(coords.x, coords.y);
				updateMyPellet(true);
			}
			canvasManager.stopMoving();
		});
		registerHandler('claim', (args) => {
			if (!room.listening) return;
			if (!room.adminModeOn || (room.adminModeOn && !claimFocus)) {
				receivedClaim(args[0]);
				clearTimeout(updateClaimLog);
				updateClaimLog = setTimeout(() => {
					if (room.claim) log(m.log_claim({ claim: room.claim }), 'claim');
				}, 3000);
			}
		});
		registerHandler('voicechat', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId) {
				const voiceId = args[1].toString();
				voice.mapVoiceId(voiceId, otherUserId);
				if (room.others[otherUserId]) room.others[otherUserId].voiceId = voiceId;
				voice.callPeerWithLimit(voiceId);
			}
		});
		registerHandler('microphonemuted', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId && room.others[otherUserId]) {
				room.others[otherUserId].microphone = false;
			}
		});
		registerHandler('microphoneunmuted', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			if (otherUserId != room.userId && room.others[otherUserId]) {
				room.others[otherUserId].microphone = true;
			}
		});
		registerHandler('listenning', (args) => {
			if (!room.listening) return;
			room.liveListening = true;
			room.liveChannel = args[0];
			log(m.log_spectrum_connected({ liveChannel: capitalize(room.liveChannel) }));
		});
		registerHandler('liveusermessage', (args) => {
			if (!room.listening) return;
			let otherUserId: string;
			switch (room.liveChannel) {
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
					console.error('missing room.liveChannel');
					return;
			}
			saveLiveUser(args[0], args[1], args[2]);
			const coords = parseLiveSpectrum(args[0], args[3]);
			const otherNickname = capitalize(room.liveChannel ?? '');
			if (otherUserId != room.userId)
				canvasManager.updatePellet(otherUserId, coords, otherNickname);
		});
		registerHandler('chatmessage', (args) => {
			if (!room.listening) return;
			const otherUserId = args[0];
			const message = args[1];
			if (otherUserId != room.userId) log(`${room.others[otherUserId].nickname}: ${message}`);
			else log(`${room.nickname}: ${message}`);
		});
		registerHandler('participantshidden', () => {
			if (!room.listening) return;
			room.participantsHidden = true;
			if (!room.adminModeOn) {
				for (const uid of Object.keys(room.others)) {
					canvasManager.deletePellet(uid, true);
				}
			} else {
				canvasManager.setParticipantsHiddenVisual(true);
			}
			log(m.log_participants_hidden(), 'event');
		});
		registerHandler('stopped', () => {
			log(m.log_spectrum_stopped(), 'leave');
			leaveSpectrum();
		});

		registerHandler('participantsshown', () => {
			if (!room.listening) return;
			room.participantsHidden = false;
			if (room.adminModeOn) {
				canvasManager.setParticipantsHiddenVisual(false);
			}
			log(m.log_participants_shown(), 'event');
		});

		websocket = startWebsocket(signIn, connectionLost);
		registeredCommands = [
			'ack',
			'nack',
			'spectrum',
			'update',
			'userleft',
			'receive',
			'handlowered',
			'madeadmin',
			'newposition',
			'claim',
			'voicechat',
			'microphonemuted',
			'microphoneunmuted',
			'listenning',
			'liveusermessage',
			'chatmessage',
			'participantshidden',
			'participantsshown',
			'stopped'
		];

		// Prepare Canvas
		canvasManager.drawCanvas('spectrum');
		canvasManager.loadSVG().catch(console.error);

		// We're joining a spectrum
		if (spectrumId) {
			toggleJoinModal();
		}
	});

	let showDragHint = $state(false);
	let dragHintTimer: ReturnType<typeof setTimeout> | undefined;

	function initPellet() {
		canvasManager.initMyPellet(() => updateMyPellet());
		showDragHint = false;
		clearTimeout(dragHintTimer);
		dragHintTimer = setTimeout(() => {
			if (!canvasManager.pelletMoved) showDragHint = true;
		}, 4000);
	}

	$effect(() => {
		if (canvasManager.pelletMoved) {
			showDragHint = false;
			clearTimeout(dragHintTimer);
		}
	});

	function receivedClaim(c: string) {
		room.claim = c.replace(/^(\|\|)+|(\|\|)+$/g, '');
	}

	let trigger = $state(false);
	let handAnimation = $state(false);
	let lowerAnimation = $state(false);
	let handUsername = $state('');
	let emoji: string = $state('');

	function sendEmoji(emojiIndex: number) {
		const emojis = ['😜', '🤔', '😵', '🤯', '🫣', '🛟', '🦝'];
		rpc('emoji', emojis[emojiIndex]);
	}

	let myHandRaised = $state(false);

	function toggleHand() {
		const myId = room.userId;
		if (myHandRaised) {
			myHandRaised = false;
			if (myId && room.others[myId]) room.others[myId].handRaised = false;
			// Lower hand animation — 🤚 slides down
			emoji = '🤚';
			trigger = false;
			handAnimation = false;
			lowerAnimation = true;
			handUsername = '';
			requestAnimationFrame(() => (trigger = true));
			rpc('lowerhand');
		} else {
			myHandRaised = true;
			if (myId && room.others[myId]) room.others[myId].handRaised = true;
			rpc('emoji', '🤚');
		}
	}

	function rpc(procedure: string, ...args: string[]) {
		const json = JSON.stringify({
			procedure: procedure,
			arguments: args
		});

		websocket.send(json);
	}

	function updateMyPellet(force = false) {
		if (canvasManager.isMoving || force) {
			const coords = canvasManager.getMyPelletCoords();
			if (coords) rpc('myposition', `${coords.x},${coords.y}`, room.nickname ?? '');
		}
	}

	let registeredCommands: string[] = [];

	onDestroy(() => {
		for (const command of registeredCommands) {
			unregisterHandler(command);
		}
		canvasManager.reset();
	});

	let wasReconnecting = false;
	let savedRejoinSpectrumId: string | undefined;
	let savedRejoinNickname: string | undefined;
	let showEjectedBanner = $state(false);
	let ejectionDetectTimer: ReturnType<typeof setTimeout> | undefined;

	function signIn() {
		if (wsState.reconnecting) {
			wasReconnecting = true;
		}
		rpc('signin', getUserId());
	}

	let isHoveringHistory = false;

	function log(message: string, type?: string) {
		const now = new Date();
		const formattedDate = now.toLocaleString(getLocale());
		room.logs.push({ message: `[${formattedDate}] ${message}`, type: type ?? 'message' });
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

	// eslint-disable-next-line svelte/no-unnecessary-state-wrap
	let liveVotes = $state(new SvelteMap<string, number>());
	// eslint-disable-next-line svelte/no-unnecessary-state-wrap
	let liveUsers = $state(new SvelteMap<string, LiveUser>());

	function saveLiveUser(
		liveUserId: string,
		liveUserNickname: string,
		liveUserProfilePictureUrl: string
	) {
		if (liveUsers.has(liveUserId)) return;

		liveUsers.set(liveUserId, {
			userId: liveUserId,
			nickname: liveUserNickname,
			profilePictureUrl: liveUserProfilePictureUrl
		});
	}

	function parseLiveSpectrum(liveUserId: string, liveSpectrum: string): { x: number; y: number } {
		const parts = liveSpectrum.split(' ');
		const vote = parseInt(parts[1]);

		liveVotes.set(liveUserId, vote);

		const userIdColor = stringToColorHex(liveUserId);
		if (room.others[userIdColor]) {
			// is participant
			room.others[userIdColor].target = convertVoteToPosition(vote);
		}

		const sum = Array.from(liveVotes.values()).reduce((acc, val) => acc + val, 0);
		const average = sum / liveVotes.size;

		const averageVote = Math.round(average);

		return convertVoteToPosition(averageVote);
	}

	function convertVoteToPosition(vote?: number) {
		let position;

		switch (vote) {
			case -3:
				position = { x: 98, y: 399 };
				break;
			case -2:
				position = { x: 157, y: 251 };
				break;
			case -1:
				position = { x: 292, y: 127 };
				break;
			case 0:
				position = { x: 475, y: 78 };
				break;
			case 1:
				position = { x: 659, y: 123 };
				break;
			case 2:
				position = { x: 771, y: 250 };
				break;
			case 3:
				position = { x: 832, y: 408 };
				break;
			default:
				position = { x: 467, y: 424 };
				break;
		}

		const randomOffsetSize = 40;
		position = {
			x: position.x + (Math.random() * randomOffsetSize - randomOffsetSize / 2),
			y: position.y + (Math.random() * randomOffsetSize - randomOffsetSize / 2)
		};

		return position;
	}

	let updateClaimLog: ReturnType<typeof setTimeout> | undefined;
	let previousClaim: string | undefined;

	function connectionLost() {
		myHandRaised = false;
		log(m.cannot_connect(), 'leave');
		notify.error(m.cannot_connect());
		if (room.listening && spectrumId && room.nickname) {
			savedRejoinSpectrumId = spectrumId;
			savedRejoinNickname = room.nickname;
		}
	}

	function rejoin() {
		if (!savedRejoinSpectrumId || !savedRejoinNickname) return;
		const id = savedRejoinSpectrumId;
		const nick = savedRejoinNickname;
		savedRejoinSpectrumId = undefined;
		savedRejoinNickname = undefined;
		showEjectedBanner = false;
		onJoinSpectrum(id, nick);
	}

	function resetPositions() {
		rpc('resetpositions');
	}

	function onCreateSpectrum(
		nickname: string,
		initialClaim?: string,
		showNeutralCircle: boolean = true
	) {
		room.listening = true;
		room.claim = initialClaim ?? '';
		rpc('startspectrum', nickname, showNeutralCircle.toString());
		showCreateModal = false;
		room.adminModeOn = true;
		rpc('claim', room.claim);
	}

	let joiningSpectrum = $state(false);

	function onJoinSpectrum(spectrumId: string, nickname: string) {
		room.listening = true;
		joiningSpectrum = true;
		rpc('joinspectrum', spectrumId, nickname);
	}

	function joinedSpectrum(id: string) {
		spectrumId = id;

		canvasManager.setNeutralCircleVisible(room.showNeutralCircle);

		if (!room.adminModeOn) {
			initPellet();
		}

		canvasManager.animatePellets();
	}

	let makeAdminTargetId: string | undefined = $state();
	const makeAdminModalId = 'makeadmin-confirm-modal';

	function promptMakeAdmin(id: string) {
		if (!room.adminModeOn) return;
		makeAdminTargetId = id;
		const el = document.getElementById(makeAdminModalId);
		if (el instanceof HTMLDialogElement) el.showModal();
	}

	function confirmMakeAdmin() {
		if (makeAdminTargetId) rpc('makeadmin', makeAdminTargetId);
		makeAdminTargetId = undefined;
		const el = document.getElementById(makeAdminModalId);
		if (el instanceof HTMLDialogElement) el.close();
	}

	let kickTargetId: string | undefined = $state();
	const kickModalId = 'kick-confirm-modal';

	function promptKick(id: string) {
		if (!room.adminModeOn) return;
		kickTargetId = id;
		const el = document.getElementById(kickModalId);
		if (el instanceof HTMLDialogElement) el.showModal();
	}

	function confirmKick() {
		if (kickTargetId) rpc('kick', kickTargetId);
		kickTargetId = undefined;
		const el = document.getElementById(kickModalId);
		if (el instanceof HTMLDialogElement) el.close();
	}

	const stopModalId = 'stop-spectrum-confirm-modal';

	function promptStopSpectrum() {
		const el = document.getElementById(stopModalId);
		if (el instanceof HTMLDialogElement) el.showModal();
	}

	function confirmStopSpectrum() {
		rpc('stopspectrum');
		const el = document.getElementById(stopModalId);
		if (el instanceof HTMLDialogElement) el.close();
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

	let showAddLiveUserParticipantModal = $state(false);

	function onConnectLive(channel: string, liveId: string, secret: string) {
		rpc('listen', channel, liveId, secret);
		room.liveListening = false;
		room.liveChannel = channel;
		toggleConnectLiveModal();
	}

	function onAddLiveUserParticipant(liveUserId: string, liveUserNickname: string) {
		const userIdColor = stringToColorHex(liveUserId);

		room.others[userIdColor] = {
			pellet: canvasManager.initOtherPellet(userIdColor, liveUserNickname, log),
			target: convertVoteToPosition(liveVotes.get(liveUserId)),
			nickname: liveUserNickname,
			microphone: false,
			volume: 0,
			handRaised: false
		};
	}

	function leaveSpectrum() {
		rpc('leavespectrum');
		spectrumId = undefined;
		myHandRaised = false;
		// Remove canvas objects before clearing store state
		canvasManager.clearAllPellets();
		leaveRoom();
		voice.disconnect();
		stopAudioForegroundService();
	}

	const copied = () => {
		notify.success(m.notify_link_copied());
	};

	let streamerMode = $state(false);

	async function toggleMicrophone() {
		if (voice.voiceState.microphone) {
			voice.muteMicrophone();
		} else if (!voice.getLocalStream()) {
			// First activation — request mic permission (Android) then enable
			const granted = await requestAudioPermission();
			if (!granted) {
				notify.error(m.cannot_connect());
				return;
			}
			// Start foreground service AFTER permission is granted (Android 14+ requirement)
			await startAudioForegroundService();
			voice.enableMicrophone().then(async () => {
				// Replace silent placeholder track with real mic in existing peer connections
				await voice.replaceAudioTrackInActiveCalls();
			});
		} else {
			voice.unmuteMicrophone();
		}
	}

	function setVolume(participantId: string, volume: number) {
		room.others[participantId].volume = volume;
		voice.setParticipantVolume(room.others[participantId].audio, volume);
	}
</script>

<dialog id={stopModalId} class="modal">
	<div class="modal-box">
		<h3 class="mb-2 text-lg font-bold">{m.stop_spectrum_confirm_title()}</h3>
		<p class="mb-6 text-sm">{m.stop_spectrum_confirm_body()}</p>
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-warning"
				onclick={() => {
					const el = document.getElementById(stopModalId);
					if (el instanceof HTMLDialogElement) el.close();
				}}>{m.cancel()}</button
			>
			<button class="btn btn-error" onclick={confirmStopSpectrum}>{m.confirm()}</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>{m.cancel()}</button>
	</form>
</dialog>

<dialog id={makeAdminModalId} class="modal">
	<div class="modal-box">
		<h3 class="mb-2 text-lg font-bold">{m.makeadmin_confirm_title()}</h3>
		<p class="mb-6 text-sm">{m.makeadmin_confirm_body()}</p>
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-warning"
				onclick={() => {
					const el = document.getElementById(makeAdminModalId);
					if (el instanceof HTMLDialogElement) el.close();
				}}>{m.cancel()}</button
			>
			<button class="btn btn-amber" onclick={confirmMakeAdmin}>{m.confirm()}</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>{m.cancel()}</button>
	</form>
</dialog>

<dialog id={kickModalId} class="modal">
	<div class="modal-box">
		<h3 class="mb-2 text-lg font-bold">{m.kick_confirm_title()}</h3>
		<p class="mb-6 text-sm">{m.kick_confirm_body()}</p>
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-warning"
				onclick={() => {
					const el = document.getElementById(kickModalId);
					if (el instanceof HTMLDialogElement) el.close();
				}}>{m.cancel()}</button
			>
			<button class="btn btn-error" onclick={confirmKick}>{m.confirm()}</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>{m.cancel()}</button>
	</form>
</dialog>

<CreateSpectrumModal bind:toggle={showCreateModal} onSubmit={onCreateSpectrum} />
<JoinSpectrumModal
	bind:toggle={showJoinModal}
	onSubmit={onJoinSpectrum}
	{spectrumId}
	loading={joiningSpectrum}
/>
<ConnectLiveModal bind:toggle={showConnectLiveModal} onSubmit={onConnectLive} />
<AddLiveUserParticipantModal
	bind:toggle={showAddLiveUserParticipantModal}
	bind:liveUsers
	onSubmit={onAddLiveUserParticipant}
/>
<EmojiBurst {emoji} {trigger} {handAnimation} {lowerAnimation} {handUsername} />

{#if !streamerMode}
	<Header subtitle={m.subtitle()} logo={LOGO_URL} logoWidth={LOGO_WIDTH} title={HEADER_TITLE}>
		<div class="items-left justify-left mt-8 ml-0 flex flex-wrap gap-4 font-mono">
			<span class="px-4 py-2">
				{#if !room.initialized}
					<span class="loading loading-spinner loading-md text-success"></span> Loading...
				{:else if wsState.reconnecting}
					<span class="loading loading-spinner loading-sm text-warning"></span>
					<span class="text-warning font-mono text-sm">Reconnecting...</span>
				{:else}
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
				{/if}
			</span>

			{#if room.initialized && spectrumId}
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
					}}
					class="btn btn-info rounded-lg px-4 py-2"
					><Fa icon={faSatelliteDish} /> {m.streamer_mode()}</button
				>
				<button onclick={leaveSpectrum} class="btn btn-warning float-right rounded-lg px-4 py-2"
					><Fa icon={faPersonWalkingArrowRight} /> {m.leave_spectrum()}</button
				>
			{:else if room.initialized && !spectrumId}
				<button onclick={toggleCreateModal} class="btn btn-success rounded-lg px-4 py-2"
					><Fa icon={faPlayCircle} /> {m.start_spectrum()}</button
				>
				<button onclick={toggleJoinModal} class="btn btn-neutral rounded-lg px-4 py-2"
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
				}}
				class="btn btn-info btn-circle"><Fa icon={faSatelliteDish} /></button
			>
		</div>
	</div>
{/if}

{#if showEjectedBanner}
	<div role="alert" class="alert alert-warning mx-4 my-2 flex flex-wrap items-center gap-2">
		<span class="font-mono text-sm">{m.ejected_from_room()}</span>
		<button onclick={rejoin} class="btn btn-sm btn-success">{m.rejoin_spectrum()}</button>
		<button onclick={() => (showEjectedBanner = false)} class="btn btn-sm btn-ghost btn-circle"
			>✕</button
		>
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
						placeholder={m.placeholder_claim()}
						readonly={!room.adminModeOn}
						bind:value={room.claim}
						onfocusin={() => {
							claimFocus = true;
							previousClaim = room.claim;
						}}
						onfocusout={() => {
							claimFocus = false;
							if (room.claim != previousClaim && room.claim)
								log(m.log_claim({ claim: room.claim }), 'claim');
						}}
						oninput={() => {
							if (room.adminModeOn) {
								rpc('claim', room.claim);
							}
						}}
						minFontSize={12}
						maxFontSize={24}
					/>
					<span class="font-bold"><Fa icon={faMapPin} /> {m.claim()}</span>
				</label>
			</header>

			<div class="border-t p-0">
				<div class="relative">
					<canvas class="m-auto" id="spectrum"></canvas>

					{#if showDragHint}
						<div class="drag-hint pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
							<span class="rounded-full bg-black/60 px-4 py-2 text-sm text-white">
								{m.drag_hint()}
							</span>
						</div>
					{/if}
				</div>

				{#if showDragHint}
					<div class="drag-hint pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2">
						<span class="rounded-full bg-black/60 px-4 py-2 text-sm text-white">
							{m.drag_hint()}
						</span>
					</div>
				{/if}

				<footer
					class="flex flex-wrap items-center justify-center gap-4"
					class:p-4={spectrumId}
					class:absolute={!room.showNeutralCircle}
					class:bottom-0={!room.showNeutralCircle}
					class:left-0={!room.showNeutralCircle}
					class:right-0={!room.showNeutralCircle}
				>
					{#if room.adminModeOn}
						<div class="flex flex-wrap items-center gap-2">
							<div class="tooltip" data-tip={m.reset_positions()}>
								<button
									class="btn btn-neutral rounded-lg px-4 py-2 font-mono"
									onclick={resetPositions}
								>
									<Fa icon={faRotateLeft} /><span class="hidden lg:!inline-block">
										{m.reset_positions()}</span
									></button
								>
							</div>

							<div
								class="tooltip"
								data-tip={room.participantsHidden ? m.show_participants() : m.hide_participants()}
							>
								<button
									class="btn btn-neutral rounded-lg px-4 py-2 font-mono"
									onclick={() => rpc(room.participantsHidden ? 'showall' : 'hideall')}
								>
									<Fa icon={room.participantsHidden ? faEye : faEyeSlash} /><span
										class="hidden lg:!inline-block"
									>
										{room.participantsHidden ? m.show_participants() : m.hide_participants()}</span
									></button
								>
							</div>

							<div class="tooltip" data-tip={m.create_pellet()}>
								<button
									class="btn btn-neutral rounded-lg px-4 py-2 font-mono"
									class:btn-disabled={myPellet}
									onclick={initPellet}
									><Fa icon={faCirclePlus} /><span class="hidden lg:!inline-block">
										{m.create_pellet()}</span
									></button
								>
							</div>

							<div class="tooltip" data-tip={m.stop_spectrum()}>
								<button
									class="btn btn-error rounded-lg px-4 py-2 font-mono"
									onclick={promptStopSpectrum}
									><Fa icon={faStop} /><span class="hidden lg:!inline-block">
										{m.stop_spectrum()}</span
									></button
								>
							</div>
							{#if room.liveChannel && room.liveListening}
								<div class="tooltip" data-tip={m.disconnect_live()}>
									<button
										class="btn btn-error rounded-lg px-4 py-2 font-mono"
										onclick={() => {
											rpc('disconnect');
											room.liveChannel = undefined;
										}}
										><Fa icon={faTowerBroadcast} /><span class="hidden lg:!inline-block">
											{m.disconnect_live()}</span
										></button
									>
								</div>
							{:else if room.liveChannel}
								<div class="tooltip" data-tip={m.connecting_live()}>
									<button class="btn btn-error rounded-lg px-4 py-2 font-mono"
										><span class="loading loading-spinner loading-xs"></span><span
											class="hidden lg:!inline-block"
										>
											{m.connecting_live()}</span
										></button
									>
								</div>
							{:else}
								<div class="tooltip" data-tip={m.connect_live()}>
									<button
										class="btn btn-error rounded-lg px-4 py-2 font-mono"
										onclick={toggleConnectLiveModal}
										><Fa icon={faTowerBroadcast} /><span class="hidden lg:!inline-block">
											{m.connect_live()}</span
										></button
									>
								</div>
							{/if}
						</div>
					{/if}

					{#if spectrumId}
						<div class="flex items-center gap-2">
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
									class="dropdown-content menu bg-base-100 rounded-box z-1 w-14 items-center p-2 shadow-sm"
								>
									<li>
										<button aria-label="😜 Winking face with tongue" onclick={() => sendEmoji(0)}
											>😜</button
										>
									</li>
									<li>
										<button aria-label="🤔 Thinking face" onclick={() => sendEmoji(1)}>🤔</button>
									</li>
									<li>
										<button aria-label="😵 Dizzy face" onclick={() => sendEmoji(2)}>😵</button>
									</li>
									<li>
										<button aria-label="🤯 Exploding head" onclick={() => sendEmoji(3)}>🤯</button>
									</li>
									<li>
										<button aria-label="🫣 Face with peeking eye" onclick={() => sendEmoji(4)}
											>🫣</button
										>
									</li>
									<li>
										<button aria-label="🛟 Ring buoy" onclick={() => sendEmoji(5)}>🛟</button>
									</li>
									<li>
										<button aria-label="🦝 Raccoon" onclick={() => sendEmoji(6)}>🦝</button>
									</li>
								</ul>
							</div>
							<button
								class="btn rounded-lg px-4 py-2 font-mono"
								class:btn-info={!myHandRaised}
								class:btn-success={myHandRaised}
								aria-label={myHandRaised ? m.lower_hand() : m.raise_hand()}
								onclick={toggleHand}
								>🤚<span class="hidden lg:!inline-block">
									{myHandRaised ? m.lower_hand() : m.raise_hand()}</span
								></button
							>
						</div>
					{/if}
				</footer>
			</div>
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
											class:hidden={!voice.voiceState.microphone}
											style="transform: scale({voiceIndicator})"
										></div>
										<div
											class="status status-lg"
											style="background: #{room.userId}; color: #{room.userId}; transform: scale({voiceIndicator})"
											role="img"
											aria-label={room.nickname}
										></div>
									</div>
								</td>
								<td>
									<span class="text-sm"
										><b>{room.nickname}{room.adminModeOn ? '*' : ''}</b>
										({m.yourself()}){#if myHandRaised}
											&nbsp;🤚{/if}</span
									>
								</td>
								<td>
									<div
										class="tooltip"
										data-tip={voice.voiceState.microphone
											? m.mute_microphone()
											: m.unmute_microphone()}
									>
										<button
											class="swap indicator"
											onclick={toggleMicrophone}
											class:swap-active={voice.voiceState.microphone &&
												voice.voiceState.peerConnected}
										>
											<div class="swap-on btn btn-ghost btn-square rounded-xl">
												<Fa icon={faMicrophone} />
											</div>
											<div
												class="swap-off btn btn-square rounded-xl border-0 bg-red-500/20 text-red-500"
											>
												<Fa icon={faMicrophoneSlash} />
											</div>
											{#if !voice.voiceState.peerConnected}
												<span class="loading loading-spinner loading-xs indicator-item"></span>
											{/if}
										</button>
									</div>
								</td>
							</tr>
						{/if}
						{#each Object.entries(room.others) as [colorHex, other] (colorHex)}
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
											role="img"
											aria-label={other.nickname}
										></div>
									</div>
								</td>
								<td>
									<label class="swap swap-flip cursor-default" class:swap-active={other.microphone}>
										<div class="swap-on">
											<Fa icon={faMicrophone} />
										</div>
										<div class="swap-off text-red-500">
											<Fa icon={faMicrophoneSlash} />
										</div>
									</label>
									<span class="text-sm"
										><b>{other.nickname}</b>{#if other.handRaised}
											🤚{/if}</span
									>
								</td>
								<td>
									<div class="dropdown dropdown-click dropdown-bottom dropdown-center">
										<button
											tabindex="0"
											class="btn btn-square rounded-xl border-0 bg-yellow-500/20 text-yellow-500"
										>
											{#if other.volume && other.volume > 50}
												<Fa icon={faVolumeHigh} />
											{:else if other.volume && other.volume > 20}
												<Fa icon={faVolumeLow} />
											{:else if other.volume && other.volume > 0}
												<Fa icon={faVolumeOff} />
											{:else}
												<Fa icon={faVolumeXmark} />
											{/if}
										</button>

										<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
										<div
											tabindex="0"
											class="dropdown-content bg-base-200 rounded-box w-48 p-4 shadow"
										>
											<span class="label">
												<span class="label-text">{m.volume_of({ name: other.nickname })}</span>
											</span>
											<input
												type="range"
												min="0"
												max="100"
												value="100"
												class="range range-xs"
												oninput={(e) => {
													setVolume(colorHex, +(e.target as HTMLInputElement)?.value);
												}}
											/>
										</div>
									</div>

									{#if room.adminModeOn}
										<div class="tooltip" data-tip={m.kick_participant()}>
											<button
												class="btn btn-square rounded-xl border-0 bg-orange-500/20 text-orange-500"
												onclick={() => {
													promptKick(colorHex);
												}}><Fa icon={faUserSlash} /></button
											>
										</div>
										<div class="tooltip" data-tip={m.make_admin()}>
											<button
												class="btn btn-square rounded-xl border-0 bg-amber-500/20 text-amber-500"
												onclick={() => {
													promptMakeAdmin(colorHex);
												}}><Fa icon={faLock} /></button
											>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
						{#if room.liveChannel && room.liveListening}
							<tr>
								<td colspan="3" class="text-center">
									<button
										class="btn btn-neutral rounded-lg px-4 py-2 font-mono"
										onclick={() =>
											(showAddLiveUserParticipantModal = !showAddLiveUserParticipantModal)}
										><Fa icon={faPersonArrowUpFromLine} /><span class="hidden lg:!inline-block">
											{m.add_live_user()}</span
										></button
									>
								</td>
							</tr>
						{/if}
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
									style="background: #{room.userId}; color: #{room.userId}; transform: scale({voiceIndicator})"
									role="img"
									aria-label={room.nickname}
								></div>
							</div>
						</div>
						<!-- Participant info -->
						<div class="flex-1">
							<div class="text-base font-bold">
								<span class="truncate text-sm"
									><b>{room.nickname}{room.adminModeOn ? '*' : ''}</b></span
								>
							</div>
							<div class="text-sm text-gray-500">
								<label class="swap swap-flip">
									<input
										type="checkbox"
										checked={voice.voiceState.microphone}
										onchange={() =>
											voice.voiceState.microphone
												? voice.muteMicrophone()
												: voice.enableMicrophone()}
										class="hidden"
									/>
									<div class="swap-on">
										<Fa icon={faMicrophone} />
									</div>
									<div class="swap-off text-red-500">
										<Fa icon={faMicrophoneSlash} />
									</div>
								</label>
							</div>
						</div>
					</div>
				</div>
				{#each Object.entries(room.others) as [colorHex, other] (colorHex)}
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
										role="img"
										aria-label={other.nickname}
									></div>
								</div>
							</div>
							<!-- Participant info -->
							<div class="flex-1">
								<div class="truncate text-base font-bold">
									{other.nickname}
								</div>
								<div class="text-sm text-gray-500">
									<label class="swap swap-flip cursor-default" class:swap-active={other.microphone}>
										<div class="swap-on">
											<Fa icon={faMicrophone} />
										</div>
										<div class="swap-off text-red-500">
											<Fa icon={faMicrophoneSlash} />
										</div>
									</label>
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
					role="region"
					aria-label="Activity log"
					tabindex="-1"
					bind:this={tbodyRef}
					onmouseenter={() => (isHoveringHistory = true)}
					onmouseleave={() => (isHoveringHistory = false)}
				>
					{#each room.logs as log (log.message + log.type)}
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

	.drag-hint {
		animation:
			drag-hint-fadein 0.6s ease forwards,
			drag-hint-blink 1.2s ease 0.8s 3;
	}

	@keyframes drag-hint-fadein {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes drag-hint-blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
</style>
