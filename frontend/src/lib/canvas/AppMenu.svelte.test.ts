import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import AppMenu from './AppMenu.svelte';

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

function stubSystemTheme(dark: boolean) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		enumerable: true,
		value: vi.fn((query: string) => ({
			matches: dark,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	});
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.clear();
	delete document.documentElement.dataset.theme;
	stubSystemTheme(false);
});

it('follows the system preference until the user picks a theme', async () => {
	stubSystemTheme(true);
	render(AppMenu);
	await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
});

it('keeps an explicit saved theme over the system preference', async () => {
	stubSystemTheme(true);
	localStorage.setItem('spectrum-theme', 'light');
	render(AppMenu);
	await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
});

it('offers a way back to v1', () => {
	const view = render(AppMenu);
	const link = view.getByTestId('back-to-v1');
	expect(link.getAttribute('href')).toBe('/');
});
