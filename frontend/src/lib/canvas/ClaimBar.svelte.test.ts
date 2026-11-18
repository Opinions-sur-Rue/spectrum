import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import ClaimBar from './ClaimBar.svelte';
import type { RoomState, SpectrumState } from './room-client';

const spectrum: SpectrumState = {
	revision: 1,
	topic: 'Original claim',
	sliceCount: 5,
	hidden: false,
	pellets: []
};
const room: RoomState = {
	roomId: 'room-one',
	userId: 'admin-one',
	role: 'admin',
	members: [],
	spectrum,
	settings: {
		notesVisibleToSpectators: true,
		pelletsVisibleToSpectators: true,
		participantSlots: 10,
		spectatorLimit: 10,
		spectatorChatEnabled: true
	}
};

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
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
	if (originalShowModal)
		Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
	else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
	vi.restoreAllMocks();
});

function setup(overrides = {}) {
	const send = vi.fn(() => true);
	return { send, ...render(ClaimBar, { room, spectrum, ready: true, send, ...overrides }) };
}

it('normalizes legacy line breaks locally without sending and exposes full heading text', async () => {
	const view = setup({ spectrum: { ...spectrum, topic: 'First\r\nSecond\nThird' } });
	expect(view.getByRole('heading', { level: 1 }).textContent).toBe('First Second Third');
	expect(view.send).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('edit-claim'));
	const input = view.getByTestId('claim-input') as HTMLInputElement;
	expect(input.tagName).toBe('INPUT');
	expect(input.type).toBe('text');
	expect(input.maxLength).toBe(500);
	expect(input.value).toBe('First Second Third');
});

it.each([{}, { ctrlKey: true }, { metaKey: true }])(
	'saves single-line edits with Enter %j',
	async (modifiers) => {
		const view = setup();
		await fireEvent.click(view.getByTestId('edit-claim'));
		const input = view.getByTestId('claim-input');
		await fireEvent.input(input, { target: { value: 'Updated claim' } });
		await fireEvent.keyDown(input, { key: 'Enter', ...modifiers });
		expect(view.send).toHaveBeenCalledWith('spectrum.topic', { topic: 'Updated claim' });
		expect(view.queryByTestId('claim-input')).toBeNull();
	}
);

it('does not submit during IME composition; Escape cancels and restores edit focus', async () => {
	const view = setup();
	await fireEvent.click(view.getByTestId('edit-claim'));
	const input = view.getByTestId('claim-input');
	await fireEvent.input(input, { target: { value: 'Draft' } });
	await fireEvent.compositionStart(input);
	await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
	await fireEvent.keyDown(input, { key: 'Enter' });
	expect(view.send).not.toHaveBeenCalled();
	await fireEvent.compositionEnd(input);
	await fireEvent.keyDown(input, { key: 'Escape' });
	expect(view.queryByTestId('claim-input')).toBeNull();
	await waitFor(() => expect(document.activeElement).toBe(view.getByTestId('edit-claim')));
	await fireEvent.click(view.getByTestId('edit-claim'));
	expect((view.getByTestId('claim-input') as HTMLInputElement).value).toBe(spectrum.topic);
});

it('normalizes pasted line breaks to spaces and respects maxlength', async () => {
	const view = setup();
	await fireEvent.click(view.getByTestId('edit-claim'));
	const input = view.getByTestId('claim-input') as HTMLInputElement;
	input.select();
	await fireEvent.paste(input, { clipboardData: { getData: () => 'One\r\nTwo\nThree' } });
	expect(input.value).toBe('One Two Three');
	input.select();
	await fireEvent.paste(input, { clipboardData: { getData: () => 'x'.repeat(600) } });
	expect(input.value).toHaveLength(500);
});

it('offers readonly full-text dialog only on demand, closes on Escape and context/content change', async () => {
	const longTopic = 'Long claim '.repeat(40);
	const props = {
		room: { ...room, role: 'spectator' as const },
		spectrum: { ...spectrum, topic: longTopic }
	};
	const view = setup(props);
	expect(view.queryByRole('dialog')).toBeNull();
	expect(view.queryByTestId('edit-claim')).toBeNull();
	const read = view.getByRole('button');
	expect(read.textContent).toBe(longTopic);
	vi.spyOn(read, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
	read.focus();
	await fireEvent.click(read);
	expect(view.getByRole('dialog').textContent).toContain(longTopic);
	await fireEvent(view.getByRole('dialog'), new Event('cancel'));
	expect(view.queryByRole('dialog')).toBeNull();
	await waitFor(() => expect(document.activeElement).toBe(read));
	await fireEvent.click(read);
	await view.rerender({ ...props, spectrum: { ...spectrum, topic: 'Changed' } });
	expect(view.queryByRole('dialog')).toBeNull();
	await fireEvent.click(view.getByRole('button'));
	await view.rerender({ ...props, room: { ...props.room, roomId: 'room-two' } });
	expect(view.queryByRole('dialog')).toBeNull();
});

it('keeps missing-claim placeholder and honors connection/presentation permissions', async () => {
	const view = setup({ spectrum: null, ready: false });
	expect(view.getByRole('heading', { level: 1 }).textContent).not.toBe('');
	expect(view.getByTestId('edit-claim').hasAttribute('disabled')).toBe(true);
	expect(view.queryByTitle(/read/i)).toBeNull();
	await view.rerender({ ready: true, spectrum });
	await fireEvent.click(view.getByTestId('edit-claim'));
	await view.rerender({ presentation: true });
	expect(view.queryByTestId('claim-input')).toBeNull();
	expect(view.queryByTestId('edit-claim')).toBeNull();
	expect(view.send).not.toHaveBeenCalled();
});

it('preserves dirty draft on server refresh, but revokes it on role or room change', async () => {
	const view = setup();
	await fireEvent.click(view.getByTestId('edit-claim'));
	await fireEvent.input(view.getByTestId('claim-input'), { target: { value: 'Draft' } });
	await view.rerender({ spectrum: { ...spectrum, topic: 'Server change' } });
	expect((view.getByTestId('claim-input') as HTMLInputElement).value).toBe('Draft');
	await view.rerender({ room: { ...room, role: 'participant' } });
	expect(view.queryByTestId('claim-input')).toBeNull();
	await view.rerender({ room });
	await fireEvent.click(view.getByTestId('edit-claim'));
	expect((view.getByTestId('claim-input') as HTMLInputElement).value).toBe('Server change');
	await view.rerender({ room: { ...room, roomId: 'room-two' }, spectrum });
	expect(view.queryByTestId('claim-input')).toBeNull();
});
