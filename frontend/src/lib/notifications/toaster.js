import { notification } from './store.js';
import { tick } from 'svelte';

/**
 * @param {HTMLUListElement} node
 * @param {string} sessionKey
 */
async function toaster(node, sessionKey) {
	const unsubscribe = notification.subscribe((value) => {
		if (!value) {
			return;
		}
		node.dispatchEvent(new CustomEvent('notify', { detail: value }));
		notification.set(undefined);
	});

	await tick();
	try {
		var session = sessionStorage.getItem(sessionKey);
		const existing = JSON.parse(session ? session : '');
		for (const n of existing) {
			notification.set(n);
		}
	} catch {
		console.log('Cannot use session storage ');
	} finally {
		try {
			sessionStorage.removeItem(sessionKey);
		} catch {
			console.log('Cannot use session storage ');
		}
	}

	return {
		destroy() {
			unsubscribe();
		}
	};
}

export { toaster };
