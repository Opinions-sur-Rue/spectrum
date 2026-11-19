import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
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

const other: NoteModel = {
	...note,
	id: 'note-b',
	title: 'Second argument',
	markdown: '# Second argument\n\nLe train réduit les coûts.',
	authorId: 'author-b',
	authorName: 'Samira'
};

function setup(overrides: Partial<ComponentProps<typeof NoteCard>> = {}) {
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
		resize: vi.fn(),
		...overrides
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

it('groups commands into explicit edit, arrange, moderation and link zones', () => {
	const { view } = setup({ admin: true, notes: [note, other] });
	for (const name of [
		m.ux_note_section_edit(),
		m.ux_note_section_organise(),
		m.ux_note_section_moderate(),
		m.ux_note_section_link()
	])
		expect(view.getByRole('heading', { name })).toBeInTheDocument();
	expect(view.getByRole('button', { name: m.v2_delete() })).toBeInTheDocument();
});

it('exposes formatting without a disclosure', () => {
	const { view } = setup();
	for (const name of ['H1', m.v2_bold(), m.v2_italic(), m.v2_list()]) {
		const button = view.getByRole('button', { name });
		expect(button).toBeInTheDocument();
		expect(button.closest('details')).toBeNull();
	}
});

it('searches a link target by title, author or excerpt and creates one link', async () => {
	const { view, send } = setup({ admin: true, notes: [note, other] });
	await fireEvent.click(view.getByText(m.ux_note_link_add()));
	const search = view.getByRole('searchbox', { name: m.ux_note_target_search() });
	const count = (text: string) =>
		expect(
			within(view.getByRole('group', { name: m.ux_note_target_legend() })).getByRole('status')
				.textContent
		).toContain(text);

	await fireEvent.input(search, { target: { value: 'samira' } });
	expect(view.getByRole('radio', { name: /Second argument/ })).toBeInTheDocument();
	count(m.ux_note_search_count({ count: 1, total: 1 }));

	await fireEvent.input(search, { target: { value: 'train' } });
	expect(view.getByRole('radio', { name: /Second argument/ })).toBeInTheDocument();

	await fireEvent.input(search, { target: { value: 'absent' } });
	expect(view.queryByRole('radio')).toBeNull();
	expect(view.getByText(m.ux_note_search_empty())).toBeInTheDocument();

	await fireEvent.input(search, { target: { value: '' } });
	expect(view.queryByRole('radio', { name: /Important note/ })).toBeNull();
	await fireEvent.click(view.getByRole('radio', { name: /Second argument/ }));
	await fireEvent.click(view.getByRole('button', { name: m.v2_create_link() }));
	expect(send).toHaveBeenCalledExactlyOnceWith('edge.create', {
		from: note.id,
		to: other.id,
		relation: 'supports',
		label: ''
	});
});

it('does not tempt readers with link creation but shows outgoing relations', () => {
	const { view } = setup({
		editable: false,
		manageable: false,
		notes: [note, other],
		edges: [{ id: 'edge-1', from: note.id, to: other.id, relation: 'supports', label: '' }]
	});
	expect(view.getByRole('heading', { name: m.ux_note_section_link() })).toBeInTheDocument();
	expect(view.queryByRole('searchbox', { name: m.ux_note_target_search() })).toBeNull();
	expect(view.queryByRole('button', { name: m.v2_create_link() })).toBeNull();
	expect(view.getByText(/soutient|supports/)).toBeInTheDocument();
});

it('offers desktop position commands without changing the editor or requiring a drag', async () => {
	const move = vi.fn();
	const { view } = setup({ move });
	await fireEvent.click(view.getByText(m.ux_note_layout()));
	for (const [label, x, y] of [
		[m.ux_note_left(), -40, 0],
		[m.ux_note_right(), 40, 0],
		[m.ux_note_up(), 0, -40],
		[m.ux_note_down(), 0, 40]
	] as const) {
		await fireEvent.click(view.getByRole('button', { name: label }));
		expect(move).toHaveBeenLastCalledWith(note.id, x, y, true);
	}
	expect(move).toHaveBeenCalledTimes(4);
	expect(view.getByRole('status')).toHaveTextContent(m.ux_note_position({ x: 0, y: 0 }));
	expect(view.getByRole('spinbutton', { name: m.ux_note_width() })).toHaveValue(300);
});

it.each([{ ready: false }, { note: { ...note, pinned: true } }])(
	'disables layout for unavailable authority: %j',
	async (change) => {
		const move = vi.fn();
		const { view } = setup({ move, ...change });
		await fireEvent.click(view.getByText(m.ux_note_layout()));
		const right = view.getByRole('button', { name: m.ux_note_right() });
		expect(right).toBeDisabled();
		await fireEvent.click(right);
		expect(move).not.toHaveBeenCalled();
	}
);

it('does not offer layout controls to readers', () => {
	const { view } = setup({ manageable: false, editable: false });
	expect(view.queryByText(m.ux_note_layout())).toBeNull();
});

it.each([{ manageable: false }, { hidden: true }, { presentation: true }])(
	'fences a retained nudge handler after context changes: %j',
	async (change) => {
		const move = vi.fn();
		const { view } = setup({ move });
		await fireEvent.click(view.getByText(m.ux_note_layout()));
		const right = view.getByRole('button', { name: m.ux_note_right() });
		await view.rerender(change);
		await fireEvent.click(right);
		expect(move).not.toHaveBeenCalled();
	}
);

it('labels outgoing links with source, relation, destination and unique delete names', async () => {
	const navigate = vi.fn();
	const { view, send } = setup({
		admin: true,
		navigate,
		notes: [note, other, { ...other, id: 'note-c' }],
		edges: [
			{ id: 'edge-1', from: note.id, to: other.id, relation: 'supports', label: '' },
			{ id: 'edge-2', from: note.id, to: 'note-c', relation: 'supports', label: '' }
		]
	});
	const list = view.getByRole('list', { name: m.ux_note_links_from({ title: note.title }) });
	const rows = within(list).getAllByRole('listitem');
	expect(rows).toHaveLength(2);
	const deletes = rows.map((row) => within(row).getAllByRole('button')[1]);
	expect(deletes[0].getAttribute('aria-label')).toContain(note.title);
	expect(deletes[0].getAttribute('aria-label')).toContain(other.title);
	expect(deletes[0].getAttribute('aria-label')).not.toBe(deletes[1].getAttribute('aria-label'));
	await fireEvent.click(
		within(rows[0]).getByRole('button', {
			name: m.ux_note_open_linked({ title: other.title, author: 'Samira' })
		})
	);
	await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(other.id));
	expect(send).not.toHaveBeenCalled();
	await fireEvent.click(deletes[1]);
	expect(send).toHaveBeenCalledExactlyOnceWith('edge.delete', { edgeId: 'edge-2' });
});

it('never navigates to a missing target or reveals its content', () => {
	const navigate = vi.fn();
	const { view } = setup({
		navigate,
		editable: false,
		manageable: false,
		edges: [{ id: 'edge-1', from: note.id, to: 'missing', relation: 'supports', label: '' }]
	});
	expect(view.getByText(m.ux_note_link_unavailable())).toBeInTheDocument();
	expect(view.container.querySelector('.relation-target')).toBeNull();
	expect(navigate).not.toHaveBeenCalled();
});
