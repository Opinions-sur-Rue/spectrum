/* eslint-disable @typescript-eslint/no-explicit-any */
import { SvelteComponentTyped } from 'svelte/types/runtime';

export type TNotificationTypes = 'default' | 'danger' | 'warning' | 'info' | 'success';

export interface TNotifier {
	send(message: string, type: TNotificationTypes, timeout?: any): void;
	danger(message: string, timeout?: any): void;
	warning(message: string, timeout?: any): void;
	info(message: string, timeout?: any): void;
	success(message: string, timeout?: any): void;
}

export interface ITheme {
	danger: '#bb2124';
	success: '#22bb33';
	warning: '#f0ad4e';
	info: '#5bc0de';
	default: '#aaaaaa';
}
type IProps = { themes?: ITheme; timeout?: any; persist?: boolean };

export class NotificationDisplay extends SvelteComponentTyped<IProps> {}

export const notifier: TNotifier;
