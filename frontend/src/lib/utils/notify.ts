import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'default';

export interface Toast {
	id: number;
	type: ToastType;
	message: string;
	duration: number;
}

// internal singleton instance
const { subscribe, update } = writable<Toast[]>([]);
let counter = 0;

function push(type: ToastType, message: string, duration = 3000) {
	const id = counter++;
	update((toasts) => [...toasts, { id, type, message, duration }]);

	setTimeout(() => {
		update((toasts) => toasts.filter((t) => t.id !== id));
	}, duration);
}

// exported singleton instance
export const notify = {
	subscribe,
	default: (msg: string, dur?: number) => push('default', msg, dur),
	success: (msg: string, dur?: number) => push('success', msg, dur),
	error: (msg: string, dur?: number) => push('error', msg, dur),
	info: (msg: string, dur?: number) => push('info', msg, dur),
	warning: (msg: string, dur?: number) => push('warning', msg, dur)
};
