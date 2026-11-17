import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import PersonalNotes from './PersonalNotes.svelte';
import { m } from '$lib/paraglide/messages.js';
import { loadPersonalNotes } from './personal-notes';

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

const value = (node: HTMLElement) => (node as HTMLTextAreaElement).value;

it('saves per room, restores after remount and never touches another room key', async () => {
	const first = render(PersonalNotes, { roomId: 'OSR-AAA' });
	await fireEvent.input(first.getByTestId('personal-notes-input'), {
		target: { value: 'Room A note' }
	});
	await waitFor(() =>
		expect(first.getByTestId('personal-notes-status').textContent).toContain(
			m.personal_notes_saved()
		)
	);
	first.unmount();
	expect(loadPersonalNotes('OSR-AAA')).toBe('Room A note');
	expect(loadPersonalNotes('OSR-BBB')).toBe('');

	const second = render(PersonalNotes, { roomId: 'OSR-BBB' });
	expect(value(second.getByTestId('personal-notes-input'))).toBe('');
	await fireEvent.input(second.getByTestId('personal-notes-input'), {
		target: { value: 'Room B note' }
	});
	await waitFor(() =>
		expect(second.getByTestId('personal-notes-status').textContent).toContain(
			m.personal_notes_saved()
		)
	);
	expect(loadPersonalNotes('OSR-AAA')).toBe('Room A note');

	// Switching rooms flushes pending text under the room it was typed in.
	await second.rerender({ roomId: 'OSR-AAA' });
	expect(value(second.getByTestId('personal-notes-input'))).toBe('Room A note');
	await fireEvent.input(second.getByTestId('personal-notes-input'), {
		target: { value: 'Room A note edited' }
	});
	await second.rerender({ roomId: 'OSR-BBB' });
	expect(loadPersonalNotes('OSR-AAA')).toBe('Room A note edited');
	expect(loadPersonalNotes('OSR-BBB')).toBe('Room B note');
});

it('deletes stored notes and reports storage failures instead of false success', async () => {
	localStorage.setItem('spectrum-personal-notes:OSR-AAA', 'Room A note');
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	expect(value(view.getByTestId('personal-notes-input'))).toBe('Room A note');
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	expect(value(view.getByTestId('personal-notes-input'))).toBe('');
	expect(loadPersonalNotes('OSR-AAA')).toBe('');
	expect(view.queryByTestId('personal-notes-clear')).toBeNull();

	vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new Error('quota exceeded');
	});
	view.unmount();
	const blocked = render(PersonalNotes, { roomId: 'OSR-CCC' });
	await fireEvent.input(blocked.getByTestId('personal-notes-input'), {
		target: { value: 'Cannot persist' }
	});
	await waitFor(() =>
		expect(blocked.getByTestId('personal-notes-status').textContent).toContain(
			m.personal_notes_unavailable()
		)
	);
});
