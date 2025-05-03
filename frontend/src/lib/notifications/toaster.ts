import { notification } from './store';
import { tick } from 'svelte';

function toaster(node: HTMLElement, sessionKey: string) {
	const unsubscribe = notification.subscribe((value) => {
		if (!value) {
			return;
		}
		node.dispatchEvent(new CustomEvent('notify', { detail: value }));
		notification.set(undefined);
	});

	(async () => {
		await tick(); // wait for DOM to be ready

		try {
			const session = sessionStorage.getItem(sessionKey);
			const existing = JSON.parse(session ?? '[]');
			for (const n of existing) {
				notification.set(n);
			}
		} catch {
			console.warn('Cannot use session storage');
		} finally {
			try {
				sessionStorage.removeItem(sessionKey);
			} catch {
				console.warn('Cannot use session storage');
			}
		}
	})();

	return {
		destroy() {
			unsubscribe();
		}
	};
}

export { toaster };
