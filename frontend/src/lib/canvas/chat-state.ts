export const CHAT_HISTORY_LIMIT = 100;

/** Audience group of a message. `room` is shared, `stage` is on-stage only and
 * `admin` is visible to administrators, including the message count. */
export type ChatChannel = 'room' | 'stage' | 'admin';
export type ChatRole = 'admin' | 'participant' | 'spectator';

export interface ChatMessage {
	roomId?: string;
	id: number;
	channel?: ChatChannel;
	memberId: string;
	nickname: string;
	color?: string;
	text: string;
	clientId?: string;
	createdAt: string;
	removed?: boolean;
}
export interface ChatState {
	sequence: number;
	messages: ChatMessage[];
}
export interface ChatError {
	requestId?: string;
	message: string;
}

export function messageChannel(message: ChatMessage): ChatChannel {
	return message.channel ?? 'room';
}

export function visibleChannels(role: ChatRole): ChatChannel[] {
	if (role === 'admin') return ['room', 'stage', 'admin'];
	if (role === 'participant') return ['room', 'stage'];
	return ['room'];
}

/** Reading rights are not writing rights: the room channel additionally
 * follows the spectator-chat setting, which the caller supplies. */
export function canWriteChannel(
	role: ChatRole,
	channel: ChatChannel,
	spectatorChatEnabled: boolean
): boolean {
	if (channel === 'room') return role !== 'spectator' || spectatorChatEnabled;
	if (channel === 'stage') return role === 'admin' || role === 'participant';
	return role === 'admin';
}

export function channelMessages(state: ChatState | null, channel: ChatChannel): ChatMessage[] {
	return (state?.messages ?? []).filter((message) => messageChannel(message) === channel);
}

export function unreadInChannel(
	state: ChatState | null,
	channel: ChatChannel,
	seen: number | null,
	ownMemberId: string
): number {
	if (seen === null) return 0;
	return channelMessages(state, channel).filter(
		(message) => message.id > seen && message.memberId !== ownMemberId
	).length;
}

/** Masked moderation keeps the entry, so the surrounding conversation does not
 * silently shift, and drops the text on every client. */
export function markChatRemoved(current: ChatState, messageId: number): ChatState {
	const index = current.messages.findIndex((message) => message.id === messageId);
	if (index < 0 || current.messages[index].removed) return current;
	const messages = [...current.messages];
	messages[index] = { ...messages[index], text: '', clientId: '', removed: true };
	return { ...current, messages };
}

export function mergeChatSnapshot(current: ChatState | null, snapshot: ChatState): ChatState {
	const messages = [
		...(snapshot.messages ?? []),
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
