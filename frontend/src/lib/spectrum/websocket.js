import { API_URL, DEBUG } from '$lib/Env.js';

const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');

/**
 * @type {WebSocket}
 */
let websocket;

/**
 * @param {() => any} onOpenCallback
 * @param {(arg1: string) => any} onMessageCallback
 * @param {() => any} onCloseCallback
 */
export function startWebsocket(onOpenCallback, onMessageCallback, onCloseCallback) {
	let websocketOutput = '';

	websocket = new WebSocket(WS_URL + '/spectrum/ws');

	websocket.onclose = async function (evt) {
		console.warn('Websocket connection lost: ' + evt.reason);

		if (onCloseCallback) await onCloseCallback();

		console.info('Retrying connection in 5 seconds');
		setTimeout(startWebsocket, 5000, onOpenCallback, onMessageCallback, onCloseCallback);
	};

	websocket.onmessage = async function (evt) {
		websocketOutput = evt.data;
		if (DEBUG) console.log('Received: ' + websocketOutput);

		const lines = websocketOutput.split(/\r?\n/);

		if (DEBUG) console.log(lines.length + ' lines parsed.');

		lines.forEach(async (line) => {
			if (onMessageCallback) await onMessageCallback(line);
		});
	};

	websocket.onopen = async function () {
		if (onOpenCallback) await onOpenCallback();
	};

	return websocket;
}
