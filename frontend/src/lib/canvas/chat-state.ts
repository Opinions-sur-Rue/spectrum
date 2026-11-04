export const CHAT_HISTORY_LIMIT = 100;
export interface ChatMessage {
	roomId?: string;
	id: number;
	memberId: string;
	nickname: string;
	color?: string;
	text: string;
	clientId?: string;
	createdAt: string;
}
export interface ChatState {
	sequence: number;
	messages: ChatMessage[];
}
export interface ChatError {
	requestId?: string;
	message: string;
}

export function mergeChatSnapshot(current: ChatState | null, snapshot: ChatState): ChatState {
	const messages = [
		...snapshot.messages,
		...(current?.messages.filter((message) => message.id > snapshot.sequence) ?? [])
	];
	return normalize(messages, Math.max(snapshot.sequence, current?.sequence ?? 0));
}

export function appendChatMessage(current: ChatState | null, message: ChatMessage): ChatState {
	return normalize(
		[...(current?.messages ?? []), message],
		Math.max(message.id, current?.sequence ?? 0)
	);
}

function normalize(messages: ChatMessage[], sequence: number): ChatState {
	const unique = new Map(messages.map((message) => [message.id, message]));
	return {
		sequence,
		messages: [...unique.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY_LIMIT)
	};
}
