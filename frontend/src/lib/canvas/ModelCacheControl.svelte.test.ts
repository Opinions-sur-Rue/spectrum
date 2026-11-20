import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { m } from '$lib/paraglide/messages.js';
import ModelCacheControl from './ModelCacheControl.svelte';

const originalShowModal = HTMLDialogElement.prototype.showModal;
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalShowModal) HTMLDialogElement.prototype.showModal = originalShowModal;
	else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
});

function setup(idle = true) {
	const remove = vi.fn().mockResolvedValue(true);
	vi.stubGlobal('caches', { delete: remove, keys: async () => [] });
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.open = true;
	});
	const view = render(ModelCacheControl, { idle });
	return { view, remove };
}

it('requires confirmation and only clears the named cache', async () => {
	const { view, remove } = setup();
	const button = view.getByTestId('model-cache-clear');
	await waitFor(() => expect(button).toBeEnabled());
	await fireEvent.click(button);
	expect(remove).not.toHaveBeenCalled();
	await fireEvent.click(view.getByRole('button', { name: m.session_cancel() }));
	expect(remove).not.toHaveBeenCalled();
	await fireEvent.click(button);
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	await waitFor(() =>
		expect(view.getByTestId('model-cache-status')).toHaveTextContent(m.model_cache_cleared())
	);
	expect(remove).toHaveBeenCalledExactlyOnceWith('spectrum-stt-public-v1');
});

it('blocks clearing during preparation and invalidates an open confirmation when activity starts', async () => {
	const { view, remove } = setup(false);
	expect(view.getByTestId('model-cache-clear')).toBeDisabled();
	await view.rerender({ idle: true });
	await fireEvent.click(view.getByTestId('model-cache-clear'));
	expect(view.getByRole('dialog')).toBeVisible();
	await view.rerender({ idle: false });
	await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
	expect(remove).not.toHaveBeenCalled();
});

it('keeps preparation blocked until asynchronous deletion completes and reports errors', async () => {
	const { view, remove } = setup();
	let reject!: (reason: Error) => void;
	remove.mockReturnValue(
		new Promise((_resolve, fail) => {
			reject = fail;
		})
	);
	await waitFor(() => expect(view.getByTestId('model-cache-clear')).toBeEnabled());
	await fireEvent.click(view.getByTestId('model-cache-clear'));
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	expect(view.getByTestId('model-cache-clear')).toBeDisabled();
	reject(new Error('denied'));
	await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(m.model_cache_failed()));
	expect(view.getByTestId('model-cache-clear')).toBeEnabled();
});
