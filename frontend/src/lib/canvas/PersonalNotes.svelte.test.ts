import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import PersonalNotes from './PersonalNotes.svelte';
import { m } from '$lib/paraglide/messages.js';
import { loadPersonalNotes } from './personal-notes';

beforeEach(() => {
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = true;
			this.querySelector('button')?.focus();
		}
	});
});

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
	expect(value(view.getByTestId('personal-notes-input'))).toBe('Room A note');
	expect(loadPersonalNotes('OSR-AAA')).toBe('Room A note');
	await fireEvent.click(view.getByTestId('confirm-session-action'));
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

it('cancel and Escape preserve private notes', async () => {
	localStorage.setItem('spectrum-personal-notes:OSR-AAA', 'Keep me');
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	expect(document.activeElement?.textContent).toBe(m.session_cancel());
	await fireEvent.click(view.getByRole('button', { name: m.session_cancel() }));
	expect(view.queryByRole('dialog')).toBeNull();
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	await fireEvent(view.getByRole('dialog'), new Event('cancel'));
	expect(view.queryByRole('dialog')).toBeNull();
	expect(value(view.getByTestId('personal-notes-input'))).toBe('Keep me');
	expect(loadPersonalNotes('OSR-AAA')).toBe('Keep me');
});

it('room switch cancels pending clear and cannot erase either room', async () => {
	localStorage.setItem('spectrum-personal-notes:OSR-AAA', 'Room A');
	localStorage.setItem('spectrum-personal-notes:OSR-BBB', 'Room B');
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	await fireEvent.input(view.getByTestId('personal-notes-input'), {
		target: { value: 'A edited' }
	});
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	const staleConfirm = view.getByTestId('confirm-session-action');
	await view.rerender({ roomId: 'OSR-BBB' });
	expect(view.queryByRole('dialog')).toBeNull();
	await fireEvent.click(staleConfirm);
	expect(value(view.getByTestId('personal-notes-input'))).toBe('Room B');
	expect(loadPersonalNotes('OSR-AAA')).toBe('A edited');
	expect(loadPersonalNotes('OSR-BBB')).toBe('Room B');
});

it('changed text invalidates clear and confirmed clear cancels deferred autosave', async () => {
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	await fireEvent.input(view.getByTestId('personal-notes-input'), {
		target: { value: 'Original' }
	});
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	await fireEvent.input(view.getByTestId('personal-notes-input'), {
		target: { value: 'New text' }
	});
	expect(view.queryByRole('dialog')).toBeNull();
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	await new Promise((resolve) => setTimeout(resolve, 450));
	expect(loadPersonalNotes('OSR-AAA')).toBe('');
	view.unmount();
	expect(loadPersonalNotes('OSR-AAA')).toBe('');
});

it('failed clear retains text and reports unavailable storage', async () => {
	localStorage.setItem('spectrum-personal-notes:OSR-AAA', 'Keep on failure');
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
		throw new Error('storage blocked');
	});
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	expect(view.getByTestId('personal-notes-status').textContent).toContain(
		m.personal_notes_unavailable()
	);
	expect(value(view.getByTestId('personal-notes-input'))).toBe('Keep on failure');
	expect(loadPersonalNotes('OSR-AAA')).toBe('Keep on failure');
});

it('unmount cancels pending clear while preserving pending text', async () => {
	const view = render(PersonalNotes, { roomId: 'OSR-AAA' });
	await fireEvent.input(view.getByTestId('personal-notes-input'), {
		target: { value: 'Keep draft' }
	});
	await fireEvent.click(view.getByTestId('personal-notes-clear'));
	const confirm = view.getByTestId('confirm-session-action');
	view.unmount();
	await fireEvent.click(confirm);
	expect(loadPersonalNotes('OSR-AAA')).toBe('Keep draft');
});
