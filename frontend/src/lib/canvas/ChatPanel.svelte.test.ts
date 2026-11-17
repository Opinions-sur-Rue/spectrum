import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import ChatPanel from './ChatPanel.svelte';
import type { RoomState } from './room-client';
import type { ChatState } from './chat-state';
import { m } from '$lib/paraglide/messages.js';

afterEach(cleanup);

function room(role: 'admin' | 'participant' | 'spectator', spectatorChatEnabled = false) {
	return {
		roomId: 'room',
		userId: 'm_me',
		role,
		settings: { spectatorChatEnabled },
		members: []
	} as unknown as RoomState;
}

const chat = (entries: number[], channel?: 'room' | 'stage' | 'admin'): ChatState => ({
	sequence: entries.at(-1) ?? 0,
	messages: entries.map((id) => ({
		id,
		memberId: id % 2 ? 'm_other' : 'm_me',
		nickname: 'Someone',
		text: `${channel ?? 'room'} message ${id}`,
		createdAt: '2026-11-17T00:00:00Z',
		...(channel ? { channel } : {})
	}))
});

function setup(
	state: RoomState,
	chatState: ChatState | null = chat([1]),
	send = vi.fn(() => true)
) {
	const view = render(ChatPanel, {
		room: state,
		ready: true,
		chat: chatState,
		error: null,
		send
	});
	return { view, send };
}

it('shows only the shared channel to spectators and both channels to participants', () => {
	const bench = setup(room('spectator'));
	expect(bench.view.queryByTestId('chat-channel-stage')).toBeNull();
	expect(bench.view.getByText('room message 1')).toBeVisible();

	const stage = setup(room('participant'), {
		sequence: 3,
		messages: [
			{ id: 1, memberId: 'm_other', nickname: 'A', text: 'shared', createdAt: '' },
			{
				id: 2,
				memberId: 'm_other',
				nickname: 'A',
				text: 'stage only',
				createdAt: '',
				channel: 'stage'
			}
		]
	});
	expect(stage.view.getByTestId('chat-channel-room')).toBeVisible();
	expect(stage.view.getByTestId('chat-channel-stage')).toBeVisible();
	expect(stage.view.queryByTestId('chat-channel-admin')).toBeNull();
	// Selecting a channel never renders another channel's text.
	expect(stage.view.getByText('shared')).toBeVisible();
	expect(stage.view.queryByText('stage only')).toBeNull();
	fireEvent.click(stage.view.getByTestId('chat-channel-stage'));
	expect(stage.view.getByText('stage only')).toBeVisible();
	expect(stage.view.queryByText('shared')).toBeNull();
});

it('keeps separate drafts per channel and sends the selected channel', async () => {
	const { view, send } = setup(room('admin'));
	const input = view.getByLabelText(m.ux_chat_message_label());
	await fireEvent.input(input, { target: { value: 'Public draft' } });
	await fireEvent.click(view.getByTestId('chat-channel-admin'));
	expect(view.getByLabelText(m.ux_chat_message_label())).toHaveValue('');
	await fireEvent.input(view.getByLabelText(m.ux_chat_message_label()), {
		target: { value: 'Admin draft' }
	});
	await fireEvent.submit(view.getByRole('log').closest('section')!.querySelector('form')!);
	expect(send).toHaveBeenLastCalledWith('chat.send', {
		text: 'Admin draft',
		clientId: expect.any(String),
		channel: 'admin'
	});
	await fireEvent.click(view.getByTestId('chat-channel-room'));
	expect(view.getByLabelText(m.ux_chat_message_label())).toHaveValue('Public draft');
});

it('hides the admin channel after demotion and keeps the room channel readable', async () => {
	const { view } = setup(room('admin'), chat([1, 3], 'admin'));
	await fireEvent.click(view.getByTestId('chat-channel-admin'));
	expect(view.getByText('admin message 1')).toBeVisible();
	await view.rerender({ room: room('participant') });
	expect(view.queryByTestId('chat-channel-admin')).toBeNull();
	expect(view.getByLabelText(m.ux_chat_message_label())).toHaveValue('');
	expect(view.getByTestId('chat-channel-hint').textContent).toBe(m.chat_channel_room_hint());
});

it('removes a message for every viewer through a two-step control', async () => {
	const { view, send } = setup(room('admin'));
	const button = view.getByLabelText(m.chat_remove());
	await fireEvent.click(button);
	expect(send).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('chat-remove-confirm'));
	expect(send).toHaveBeenCalledWith('chat.remove', { messageId: 1 });
});

it('renders masked moderation without the original text and never offers to remove it twice', () => {
	const view = render(ChatPanel, {
		room: room('admin'),
		ready: true,
		error: null,
		send: vi.fn(() => true),
		chat: {
			sequence: 1,
			messages: [
				{
					id: 1,
					memberId: 'm_other',
					nickname: 'Someone',
					text: '',
					createdAt: '',
					channel: 'room',
					removed: true
				}
			]
		}
	});
	expect(view.getByText(m.chat_removed_message())).toBeVisible();
	expect(view.queryByLabelText(m.chat_remove())).toBeNull();
	view.unmount();
});

it('refuses to queue another send while a request is pending', async () => {
	const send = vi.fn(() => true);
	const view = render(ChatPanel, {
		room: room('participant'),
		ready: true,
		chat: chat([1]),
		error: null,
		send
	});
	const input = view.getByLabelText(m.ux_chat_message_label());
	await fireEvent.input(input, { target: { value: 'First' } });
	await fireEvent.keyDown(input, { key: 'Enter' });
	expect(send).toHaveBeenCalledTimes(1);
	await fireEvent.input(input, { target: { value: 'Second' } });
	await fireEvent.keyDown(input, { key: 'Enter' });
	expect(send).toHaveBeenCalledTimes(1);
	view.unmount();
});
