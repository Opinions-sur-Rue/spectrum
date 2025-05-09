<script lang="ts">
	import Notification from './Notification.svelte';
	import { writable } from 'svelte/store';
	import { toaster } from './toaster.js';

	const themes = {
		danger: 'error',
		success: 'success',
		warning: 'warning',
		info: 'info',
		default: 'info'
	};
	type ThemeKey = keyof typeof themes;

	export let timeout = 3000;
	export let sessionKey = 'spectrum-toasts';

	interface Toast {
		id: string;
		message: string;
		background: string;
		persist: boolean;
		timeout: number;
		width: string;
	}

	let toasts = writable<Toast[]>([]);

	function createToast({ detail }: CustomEvent) {
		const { message, type, options = {} } = detail;
		const background = themes[type as ThemeKey] || themes.default;
		const persist = options.persist;
		const computedTimeout = options.persist ? 0 : options.timeout || timeout;
		const id = Math.random()
			.toString(36)
			.replace(/[^a-z]+/g, '');

		try {
			sessionStorage.setItem(
				sessionKey,
				JSON.stringify([
					...JSON.parse(sessionStorage.getItem(sessionKey) || '[]'),
					{ ...detail, id }
				])
			);
		} catch (e) {
			if (e instanceof Error) {
				console.log('Cannot use session storage: ' + e.message);
			} else {
				console.log('Cannot use session storage: Unknown error', e);
			}
		}

		toasts.update((current) => [
			{
				id,
				message,
				background,
				persist,
				timeout: computedTimeout,
				width: '100%'
			},
			...current
		]);
	}

	function purge(id: string) {
		const filter = (t: { id: string }) => t.id !== id;
		toasts.update((current) => current.filter(filter));
		try {
			sessionStorage.setItem(
				sessionKey,
				JSON.stringify(JSON.parse(sessionStorage.getItem(sessionKey) || '[]').filter(filter))
			);
		} catch (e: unknown) {
			if (e instanceof Error) {
				console.log('Cannot use session storage ' + e.message);
			} else {
				console.log('Cannot use session storage ' + e);
			}
		}
	}
</script>

<div class="toast toast-top toast-end" use:toaster={sessionKey} on:notify={createToast}>
	{#each $toasts as toast (toast.id)}
		<Notification
			background={toast.background}
			close={() => purge(toast.id)}
			message={toast.message}
			duration={toast.timeout}
		/>
	{/each}
</div>

<style>
</style>
