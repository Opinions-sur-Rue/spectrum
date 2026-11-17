import { describe, expect, it } from 'vitest';
import {
	appendChatMessage,
	canWriteChannel,
	channelMessages,
	markChatRemoved,
	mergeChatSnapshot,
	messageChannel,
	unreadInChannel,
	visibleChannels,
	type ChatMessage,
	type ChatState
} from './chat-state';

const message = (id: number): ChatMessage => ({
	id,
	memberId: 'public-member',
	nickname: 'Guest',
	text: `message ${id}`,
	createdAt: '2026-11-03T00:00:00Z'
});

describe('ephemeral chat history', () => {
	it('merges a delayed history response with live messages without duplicates', () => {
		let current = appendChatMessage(null, message(2));
		current = mergeChatSnapshot(current, { sequence: 2, messages: [message(1), message(2)] });
		current = appendChatMessage(current, message(2));
		expect(current.messages.map((entry) => entry.id)).toEqual([1, 2]);
	});
	it('orders messages received out of order', () => {
		const current = appendChatMessage(appendChatMessage(null, message(3)), message(2));
		expect(current.messages.map((entry) => entry.id)).toEqual([2, 3]);
		expect(current.sequence).toBe(3);
	});
	it('retains only the last 100 messages', () => {
		const current = mergeChatSnapshot(null, {
			sequence: 120,
			messages: Array.from({ length: 120 }, (_, index) => message(index + 1))
		});
		expect(current.messages).toHaveLength(100);
		expect(current.messages[0].id).toBe(21);
	});

	it('keeps legacy messages in the room channel and filters by channel', () => {
		const state: ChatState = {
			sequence: 3,
			messages: [
				message(1),
				{ ...message(2), channel: 'stage' },
				{ ...message(3), channel: 'admin' }
			]
		};
		expect(channelMessages(state, 'room').map((entry) => entry.id)).toEqual([1]);
		expect(channelMessages(state, 'stage').map((entry) => entry.id)).toEqual([2]);
		expect(messageChannel(state.messages[0])).toBe('room');
	});

	it('lists only channels the role may read', () => {
		expect(visibleChannels('spectator')).toEqual(['room']);
		expect(visibleChannels('participant')).toEqual(['room', 'stage']);
		expect(visibleChannels('admin')).toEqual(['room', 'stage', 'admin']);
	});

	it('separates reading from writing and keeps the spectator setting on the room channel', () => {
		expect(canWriteChannel('spectator', 'room', false)).toBe(false);
		expect(canWriteChannel('spectator', 'room', true)).toBe(true);
		expect(canWriteChannel('participant', 'room', false)).toBe(true);
		expect(canWriteChannel('participant', 'stage', true)).toBe(true);
		expect(canWriteChannel('spectator', 'stage', true)).toBe(false);
		expect(canWriteChannel('spectator', 'admin', true)).toBe(false);
		expect(canWriteChannel('participant', 'admin', true)).toBe(false);
		expect(canWriteChannel('admin', 'admin', false)).toBe(true);
	});

	it('counts unread messages per channel without crediting your own', () => {
		const state: ChatState = {
			sequence: 4,
			messages: [
				{ ...message(1), channel: 'room' },
				{ ...message(2), channel: 'stage', memberId: 'someone-else' },
				{ ...message(3), channel: 'stage' },
				{ ...message(4), channel: 'admin', memberId: 'someone-else' }
			]
		};
		expect(unreadInChannel(state, 'stage', 1, 'public-member')).toBe(1);
		expect(unreadInChannel(state, 'room', 1, 'public-member')).toBe(0);
		expect(unreadInChannel(state, 'admin', null, 'public-member')).toBe(0);
	});

	it('masks removed messages in place and ignores unknown or repeat ids', () => {
		const state: ChatState = {
			sequence: 2,
			messages: [
				{ ...message(1), channel: 'room', clientId: 'draft-1' },
				{ ...message(2), channel: 'stage' }
			]
		};
		const masked = markChatRemoved(state, 1);
		expect(masked.messages[0]).toMatchObject({ id: 1, removed: true, text: '', clientId: '' });
		expect(masked.messages[1].text).toBe('message 2');
		expect(state.messages[0].text).toBe('message 1');
		expect(markChatRemoved(masked, 1)).toBe(masked);
		expect(markChatRemoved(masked, 99)).toBe(masked);
	});
});
