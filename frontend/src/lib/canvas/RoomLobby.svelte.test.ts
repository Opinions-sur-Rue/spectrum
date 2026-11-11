import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { m } from '$lib/paraglide/messages.js';
import RoomLobby from './RoomLobby.svelte';

afterEach(cleanup);

it('accepts lowercase invitation links and normalizes the sent code', async () => {
	const send = vi.fn(() => true);
	const view = render(RoomLobby, { connected: true, send });
	const input = view.getByLabelText(m.v2_room_id());
	await fireEvent.input(input, {
		target: { value: 'https://spectrum.utile.space/v2?room=osr-abcd1234' }
	});
	await fireEvent.submit(input.closest('form')!);
	expect(send).toHaveBeenCalledWith('room.join', { roomId: 'OSR-ABCD1234' });
	expect((input as HTMLInputElement).value).toBe('OSR-ABCD1234');
});

it('keeps malformed input local with an accessible error and clears it on edit', async () => {
	const send = vi.fn(() => true);
	const view = render(RoomLobby, { connected: true, send });
	const input = view.getByLabelText(m.v2_room_id());
	await fireEvent.input(input, { target: { value: 'https://example.com/index' } });
	await fireEvent.submit(input.closest('form')!);
	expect(send).not.toHaveBeenCalled();
	expect(input.getAttribute('aria-invalid')).toBe('true');
	expect(view.getByRole('alert').textContent).toBe(m.ux_room_code_invalid());
	expect(document.activeElement).toBe(input);
	await fireEvent.input(input, { target: { value: 'abcd1234' } });
	expect(input.getAttribute('aria-invalid')).toBe('false');
	expect(view.queryByRole('alert')).toBeNull();
	await view.rerender({ connected: false, send });
	await fireEvent.submit(input.closest('form')!);
	expect(send).not.toHaveBeenCalled();
});
