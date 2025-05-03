import { notification } from './store';

export interface NotificationOptions {
	timeout?: number;
	[key: string]: unknown; // optional: allow extra options
}

function parseLegacyOptions(
	options: number | NotificationOptions | undefined
): NotificationOptions | undefined {
	return typeof options === 'number' ? { timeout: options } : options;
}

export function send(message: string, type = 'default', options: number | NotificationOptions) {
	notification.set({ type, message, options: parseLegacyOptions(options) });
}

export function danger(message: string, options: number | NotificationOptions) {
	send(message, 'danger', options);
}

export function warning(message: string, options: number | NotificationOptions) {
	send(message, 'warning', options);
}

export function info(message: string, options: number | NotificationOptions) {
	send(message, 'info', options);
}

export function success(message: string, options: number | NotificationOptions) {
	send(message, 'success', options);
}
