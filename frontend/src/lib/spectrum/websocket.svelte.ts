import { SvelteMap } from 'svelte/reactivity';

import { API_URL, DEBUG } from '$lib/env';

const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');

let websocket: WebSocket;

/** Reactive WebSocket state. Use wsState.reconnecting in templates. */
export const wsState = $state({ reconnecting: false });

// ---------------------------------------------------------------------------
// RPC dispatcher
// ---------------------------------------------------------------------------

export type RpcHandler = (args: string[]) => void;

const handlers = new SvelteMap<string, RpcHandler>();

/**
 * Register a handler for a specific RPC command.
 * Call this before `startWebsocket` (e.g. in onMount or at module scope).
 */
export function registerHandler(command: string, handler: RpcHandler): void {
	handlers.set(command, handler);
}

/**
 * Unregister a previously registered handler.
 */
export function unregisterHandler(command: string): void {
	handlers.delete(command);
}

function dispatch(line: string): void {
	let rpc: { procedure?: string; arguments?: string[] };
	try {
		rpc = JSON.parse(line) as { procedure?: string; arguments?: string[] };
	} catch {
		if (DEBUG) console.warn('WS: failed to parse line:', line);
		return;
	}

	if (!rpc.procedure) return;

	const handler = handlers.get(rpc.procedure);
	if (handler) {
		handler(rpc.arguments ?? []);
	} else if (DEBUG) {
		console.warn('WS: no handler registered for command:', rpc.procedure);
	}
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

export function startWebsocket(onOpenCallback: () => void, onCloseCallback: () => void) {
	websocket = new WebSocket(WS_URL + '/spectrum/ws');

	websocket.onclose = async function (evt) {
		console.warn('Websocket connection lost: ' + evt.reason);

		wsState.reconnecting = true;

		if (onCloseCallback) await onCloseCallback();

		console.info('Retrying connection in 5 seconds');
		setTimeout(startWebsocket, 5000, onOpenCallback, onCloseCallback);
	};

	websocket.onmessage = function (evt) {
		const raw: string = evt.data;
		if (DEBUG) console.log('Received: ' + raw);

		const lines = raw.split(/\r?\n/);
		if (DEBUG) console.log(lines.length + ' lines parsed.');

		for (const line of lines) {
			dispatch(line);
		}
	};

	websocket.onopen = async function () {
		wsState.reconnecting = false;
		if (onOpenCallback) await onOpenCallback();
	};

	return websocket;
}
