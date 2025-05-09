import { API_URL, DEBUG } from '$lib/env';

const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');

let websocket: WebSocket;

export function startWebsocket(
	onOpenCallback: () => void,
	onMessageCallback: (arg: string) => void,
	onCloseCallback: () => void
) {
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
