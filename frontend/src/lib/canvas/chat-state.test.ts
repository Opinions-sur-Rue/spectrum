import { describe, expect, it } from 'vitest';
import { appendChatMessage, mergeChatSnapshot, type ChatMessage } from './chat-state';

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
});
