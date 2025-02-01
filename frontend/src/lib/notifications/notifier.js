import { notification } from './store.js';

/**
 * @param {any} options
 */
function parseLegacyOptions(options) {
	return typeof options === 'number' ? { timeout: options } : options;
}

/**
 * @param {string} message
 * @param {any} options
 */
export function send(message, type = 'default', options) {
	notification.set({ type, message, options: parseLegacyOptions(options) });
}

/**
 * @param {string} message
 * @param {any} options
 */
export function danger(message, options) {
	send(message, 'danger', options);
}

/**
 * @param {string} message
 * @param {any} options
 */
export function warning(message, options) {
	send(message, 'warning', options);
}

/**
 * @param {string} message
 * @param {any} options
 */
export function info(message, options) {
	send(message, 'info', options);
}

/**
 * @param {string} message
 * @param {any} options
 */
export function success(message, options) {
	send(message, 'success', options);
}
