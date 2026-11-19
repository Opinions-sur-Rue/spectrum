import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import MobileBrowserHelp from './MobileBrowserHelp.svelte';
import { m } from '$lib/paraglide/messages.js';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
	Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
	else Reflect.deleteProperty(navigator, 'clipboard');
});

it('opens detected webview help, copies exact current URL and can collapse', async () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android 14; wv) Discord');
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
	const view = render(MobileBrowserHelp);
	expect(view.container.querySelector('details')?.open).toBe(true);
	expect(view.getByText(m.ux_browser_android())).toBeInTheDocument();
	await fireEvent.click(view.getByRole('button', { name: m.ux_browser_copy() }));
	expect(writeText).toHaveBeenCalledExactlyOnceWith(window.location.href);
	expect(view.getByRole('status')).toHaveTextContent(m.ux_browser_copied());
	await fireEvent.click(view.getByRole('button', { name: m.ux_browser_close() }));
	expect(view.container.querySelector('details')?.open).toBe(false);
});

it('offers manual help on iOS without claiming reliable detection', async () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
		'iPhone Version/18.0 Mobile Safari/604.1'
	);
	const view = render(MobileBrowserHelp);
	expect(view.container.querySelector('details')?.open).toBe(false);
	await fireEvent.click(view.getByText(m.ux_browser_title()));
	expect(view.getByText(m.ux_browser_ios())).toBeInTheDocument();
	expect(view.getByText(m.ux_browser_privacy())).toBeInTheDocument();
});

it('keeps a selectable URL when clipboard access fails', async () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android; wv)');
	vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
		writeText: vi.fn().mockRejectedValue(new Error('denied'))
	} as unknown as Clipboard);
	const view = render(MobileBrowserHelp);
	await fireEvent.click(view.getByRole('button', { name: m.ux_browser_copy() }));
	expect(view.getByRole('textbox')).toHaveValue(window.location.href);
	expect(view.getByRole('status')).toHaveTextContent('');
});

it('does not change desktop layout', () => {
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('X11 Linux Chrome/130');
	const view = render(MobileBrowserHelp);
	expect(view.queryByTestId('mobile-browser-help')).toBeNull();
});
