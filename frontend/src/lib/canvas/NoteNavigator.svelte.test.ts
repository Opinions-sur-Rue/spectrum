import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { m } from '$lib/paraglide/messages.js';
import NoteNavigator from './NoteNavigator.svelte';
import type { NoteModel } from './models';

const notes = [
	{ id: 'one', title: 'Énergie', markdown: 'Réduire les coûts' },
	{ id: 'two', title: 'Mobilité', markdown: 'Le train' }
] as NoteModel[];

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
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it('focuses search, explains empty results and allows clearing or selecting a note', async () => {
	const select = vi.fn();
	const view = render(NoteNavigator, { notes, select });
	await fireEvent.click(view.getByLabelText(m.ux_find_note()));
	const search = view.getByRole('searchbox', { name: m.ux_note_search() });
	await waitFor(() => expect(document.activeElement).toBe(search));
	await fireEvent.input(search, { target: { value: 'couts' } });
	expect(view.getByRole('button', { name: /Énergie/ })).toBeTruthy();
	expect(view.queryByRole('button', { name: /Mobilité/ })).toBeNull();
	await fireEvent.input(search, { target: { value: 'absent' } });
	expect(view.getByText(m.ux_note_search_empty())).toBeTruthy();
	await fireEvent.click(view.getByRole('button', { name: m.ux_note_search_clear() }));
	expect((search as HTMLInputElement).value).toBe('');
	expect(document.activeElement).toBe(search);
	await fireEvent.click(view.getByRole('button', { name: 'Mobilité' }));
	expect(select).toHaveBeenCalledWith(notes[1]);
	expect(view.container.querySelector('details')!.open).toBe(false);
});

it('does not retain a removed note as a search result', async () => {
	const view = render(NoteNavigator, { notes, select: vi.fn() });
	await fireEvent.click(view.getByLabelText(m.ux_find_note()));
	const search = view.getByRole('searchbox', { name: m.ux_note_search() });
	await waitFor(() => expect(document.activeElement).toBe(search));
	await fireEvent.input(search, { target: { value: 'energie' } });
	await view.rerender({ notes: [notes[1]], select: vi.fn() });
	expect(view.queryByRole('button', { name: 'Énergie' })).toBeNull();
	expect(view.getByText(m.ux_note_search_empty())).toBeTruthy();
});

it('opens with the keyboard shortcut, highlights matches and opens the first result on Enter', async () => {
	const select = vi.fn();
	const view = render(NoteNavigator, { notes, select });
	await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
	const search = view.getByRole('searchbox', { name: m.ux_note_search() });
	await waitFor(() => expect(document.activeElement).toBe(search));
	expect(view.container.querySelector('details')!.open).toBe(true);

	await fireEvent.input(search, { target: { value: 'energie' } });
	const result = view.getByRole('button', { name: 'Énergie' });
	expect(result.querySelector('mark')?.textContent).toBe('Énergie');

	await fireEvent.submit(search.closest('form')!);
	expect(select).toHaveBeenCalledWith(notes[0]);
	expect(view.container.querySelector('details')!.open).toBe(false);

	await fireEvent.keyDown(window, { key: 'K', metaKey: true, shiftKey: true });
	expect(view.container.querySelector('details')!.open).toBe(false);
});
