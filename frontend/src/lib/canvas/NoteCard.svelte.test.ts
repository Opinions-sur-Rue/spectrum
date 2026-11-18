import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import NoteCard from './NoteCard.svelte';
import { NoteDrafts } from './note-drafts';
import type { NoteModel } from './models';
import { m } from '$lib/paraglide/messages.js';

beforeEach(() => {
	vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
		matches: false,
		media,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn()
	}));
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
	vi.restoreAllMocks();
});

const note: NoteModel = {
	id: 'note-a',
	title: 'Important note',
	markdown: '# Important note\n\nKeep this',
	x: 0,
	y: 0,
	width: 300,
	height: 220,
	color: '',
	moderation: 'approved',
	visible: true,
	authorId: 'author-a',
	version: 1
};

function setup() {
	const send = vi.fn();
	const view = render(NoteCard, {
		note: { ...note },
		drafts: new NoteDrafts(),
		editable: true,
		manageable: true,
		authorName: 'Author',
		admin: false,
		ready: true,
		audienceEnabled: false,
		notes: [note],
		edges: [],
		scale: 1,
		send,
		move: vi.fn(),
		resize: vi.fn()
	});
	return { view, send };
}

it('identifies shared note and sends exactly one delete only after confirmation', async () => {
	const { view, send } = setup();
	await fireEvent.click(view.getByRole('button', { name: m.v2_delete() }));
	expect(send).not.toHaveBeenCalled();
	expect(view.getByRole('dialog').textContent).toContain(
		m.ux_delete_note_title({ title: note.title })
	);
	expect(document.activeElement?.textContent).toBe(m.session_cancel());
	const confirm = view.getByTestId('confirm-session-action');
	await fireEvent.click(confirm);
	await fireEvent.click(confirm);
	expect(send).toHaveBeenCalledExactlyOnceWith('note.delete', { noteId: note.id });
	expect(view.queryByRole('dialog')).toBeNull();
});

it('cancel and native Escape cancellation never delete shared notes', async () => {
	const { view, send } = setup();
	const opener = view.getByRole('button', { name: m.v2_delete() });
	vi.spyOn(opener, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
	opener.focus();
	await fireEvent.click(opener);
	await fireEvent.click(view.getByRole('button', { name: m.session_cancel() }));
	expect(view.queryByRole('dialog')).toBeNull();
	expect(document.activeElement).toBe(opener);
	await fireEvent.click(view.getByRole('button', { name: m.v2_delete() }));
	await fireEvent(view.getByRole('dialog'), new Event('cancel'));
	expect(view.queryByRole('dialog')).toBeNull();
	expect(document.activeElement).toBe(opener);
	expect(send).not.toHaveBeenCalled();
});

it.each([
	{ ready: false },
	{ manageable: false },
	{ editable: false },
	{ editable: false, manageable: false },
	{ note: { ...note, version: 2 } },
	{ note: { ...note, id: 'note-b' } }
])('invalidates pending deletion on context change: %j', async (change) => {
	const { view, send } = setup();
	await fireEvent.click(view.getByRole('button', { name: m.v2_delete() }));
	const confirm = view.getByTestId('confirm-session-action');
	await view.rerender(change);
	expect(view.queryByRole('dialog')).toBeNull();
	await fireEvent.click(confirm);
	expect(send).not.toHaveBeenCalled();
	if ('ready' in change) {
		await view.rerender({ ready: true });
		expect(view.queryByRole('dialog')).toBeNull();
	}
});

it('unmount cancels pending shared-note deletion', async () => {
	const { view, send } = setup();
	await fireEvent.click(view.getByRole('button', { name: m.v2_delete() }));
	const confirm = view.getByTestId('confirm-session-action');
	view.unmount();
	await fireEvent.click(confirm);
	expect(send).not.toHaveBeenCalled();
});
