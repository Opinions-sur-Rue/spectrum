import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomClient } from './room-client';

class FakeSocket {
	static OPEN = 1;
	static instances: FakeSocket[] = [];
	readyState = 1;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	constructor() {
		FakeSocket.instances.push(this);
	}
	send(value: string) {
		this.sent.push(value);
	}
	close() {
		this.readyState = 3;
		this.onclose?.();
	}
	receive(value: unknown) {
		this.onmessage?.({ data: JSON.stringify(value) });
	}
}

function fixture(roomId = 'ROOM') {
	const callbacks = {
		status: vi.fn(),
		room: vi.fn(),
		snapshot: vi.fn(),
		spectrum: vi.fn(),
		chat: vi.fn(),
		chatError: vi.fn(),
		roomClosed: vi.fn(),
		reaction: vi.fn(),
		live: vi.fn(),
		error: vi.fn()
	};
	const client = new RoomClient('anonymous-user', roomId, callbacks);
	client.connect();
	const socket = FakeSocket.instances.at(-1)!;
	socket.onopen?.();
	return { client, socket, callbacks };
}

describe('RoomClient', () => {
	it('keeps a failed admission error instead of refreshing a nonexistent room', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		const count = socket.sent.length;
		socket.receive({
			v: 2,
			op: 'error',
			payload: { code: 'room_join_failed', message: 'room not found' }
		});
		expect(socket.sent).toHaveLength(count);
		expect(callbacks.error).toHaveBeenLastCalledWith('room not found');
		socket.receive({
			v: 2,
			op: 'error',
			payload: { code: 'not_in_room', message: 'Stale refresh' }
		});
		expect(callbacks.error).toHaveBeenCalledTimes(1);
		client.destroy();
	});

	it('retires a stale room when re-admission fails after a connection loss', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM', role: 'admin' } });
		socket.close();
		vi.advanceTimersByTime(2000);
		const next = FakeSocket.instances.at(-1)!;
		next.onopen?.();
		next.receive({ procedure: 'ack', arguments: ['signin'] });
		next.receive({
			v: 2,
			op: 'error',
			payload: { code: 'room_join_failed', message: 'room not found' }
		});
		expect(callbacks.roomClosed).toHaveBeenCalledOnce();
		expect(callbacks.error).toHaveBeenLastCalledWith('room not found');
		const received = callbacks.room.mock.calls.length;
		next.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM', role: 'admin' } });
		expect(callbacks.room).toHaveBeenCalledTimes(received);
		client.destroy();
	});
	it('filters live snapshots by room/revision and strips voters after authority transfer', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		const scene = { revision: 10, topic: '', sliceCount: 7, hidden: false, pellets: [] };
		const room = { roomId: 'ROOM', role: 'admin', spectrum: scene };
		socket.receive({ v: 2, op: 'room.state', payload: room });
		const live = {
			roomId: 'ROOM',
			revision: 10,
			platform: 'twitch',
			status: 'connected',
			count: 1,
			limit: 1000,
			tiktokAvailable: false,
			users: [{ id: 'l_one', nickname: 'Voter', vote: 1, selected: false }]
		};
		socket.receive({ v: 2, op: 'live.snapshot', payload: { ...live, roomId: 'OTHER' } });
		socket.receive({ v: 2, op: 'live.snapshot', payload: { ...live, revision: 9 } });
		expect(callbacks.live).not.toHaveBeenCalled();
		expect(JSON.parse(socket.sent.at(-1)!).op).toBe('live.get');
		socket.receive({ v: 2, op: 'live.snapshot', payload: live });
		expect(callbacks.live.mock.lastCall?.[0].users).toHaveLength(1);
		socket.receive({ v: 2, op: 'room.state', payload: { ...room, role: 'participant' } });
		expect(callbacks.live.mock.lastCall?.[0].users).toEqual([]);
		socket.receive({ v: 2, op: 'live.snapshot', payload: live });
		expect(callbacks.live.mock.lastCall?.[0].users).toEqual([]);
		client.destroy();
	});
	it('scopes transient reactions and does not auto-rejoin a room after leaving', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		const reaction = { roomId: 'ROOM', memberId: 'm_guest', nickname: 'Guest', emoji: '👍' };
		socket.receive({ v: 2, op: 'room.reaction', payload: { ...reaction, roomId: 'OTHER' } });
		expect(callbacks.reaction).not.toHaveBeenCalled();
		socket.receive({ v: 2, op: 'room.reaction', payload: reaction });
		expect(callbacks.reaction).toHaveBeenCalledWith(reaction);
		socket.receive({ v: 2, op: 'room.closed', payload: { roomId: 'OTHER' } });
		expect(callbacks.roomClosed).not.toHaveBeenCalled();
		socket.receive({ v: 2, op: 'room.closed', payload: { roomId: 'ROOM', reason: 'left' } });
		expect(callbacks.roomClosed).toHaveBeenCalledOnce();
		socket.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM' } });
		expect(callbacks.room).not.toHaveBeenCalled();
		socket.receive({ v: 2, op: 'room.reaction', payload: reaction });
		expect(callbacks.reaction).toHaveBeenCalledTimes(1);
		socket.receive({
			v: 2,
			op: 'error',
			payload: { code: 'not_in_room', message: 'Stale refresh' }
		});
		expect(callbacks.error).not.toHaveBeenCalled();
		socket.close();
		vi.advanceTimersByTime(2000);
		const next = FakeSocket.instances.at(-1)!;
		next.onopen?.();
		next.receive({ procedure: 'ack', arguments: ['signin'] });
		expect(next.sent).toHaveLength(1);
		client.send('room.join', { roomId: 'ROOM' });
		next.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM' } });
		expect(callbacks.room).toHaveBeenCalledOnce();
		client.destroy();
	});
	it('loads chat once per connection, merges history, and clears it when the room closes', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM' } });
		socket.receive({ v: 2, op: 'room.state', payload: { roomId: 'ROOM' } });
		expect(
			socket.sent.map((raw) => JSON.parse(raw).op).filter((op) => op === 'chat.get')
		).toHaveLength(1);
		const message = {
			roomId: 'ROOM',
			id: 1,
			memberId: 'public',
			nickname: 'Guest',
			text: 'Hello',
			createdAt: '2026-11-03T00:00:00Z'
		};
		socket.receive({ v: 2, op: 'chat.message', payload: message });
		socket.receive({
			v: 2,
			op: 'chat.snapshot',
			payload: { roomId: 'ROOM', sequence: 1, messages: [message] }
		});
		expect(callbacks.chat.mock.lastCall?.[0].messages).toHaveLength(1);
		const beforeOtherRoom = callbacks.chat.mock.calls.length;
		socket.receive({ v: 2, op: 'chat.message', payload: { ...message, roomId: 'OTHER', id: 2 } });
		expect(callbacks.chat).toHaveBeenCalledTimes(beforeOtherRoom);
		const count = socket.sent.length;
		socket.receive({
			v: 2,
			op: 'error',
			payload: { code: 'chat_rejected', message: 'Wait', requestId: 'draft-1' }
		});
		expect(callbacks.chatError).toHaveBeenCalledWith({ message: 'Wait', requestId: 'draft-1' });
		expect(socket.sent).toHaveLength(count);
		socket.receive({ procedure: 'stopped' });
		expect(callbacks.roomClosed).toHaveBeenCalledOnce();
		const delivered = callbacks.chat.mock.calls.length;
		socket.receive({ v: 2, op: 'chat.message', payload: { ...message, id: 2 } });
		expect(callbacks.chat).toHaveBeenCalledTimes(delivered);
		client.destroy();
	});
	it('applies live deltas without refetching and coalesces structural refreshes', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		const spectrum = {
			revision: 10,
			topic: '',
			sliceCount: 7,
			hidden: false,
			pellets: [{ memberId: 'a', nickname: 'Alice', color: 'fff', x: 100, y: 200, version: 1 }]
		};
		socket.receive({ v: 2, op: 'spectrum.snapshot', payload: spectrum });
		const count = socket.sent.length;
		socket.receive({
			v: 2,
			op: 'spectrum.moved',
			payload: { revision: 10, memberId: 'a', x: 120, y: 220, version: 2 }
		});
		expect(callbacks.spectrum.mock.lastCall?.[0].pellets[0].x).toBe(120);
		expect(socket.sent).toHaveLength(count);
		socket.receive({
			v: 2,
			op: 'spectrum.moved',
			payload: { revision: 11, memberId: 'a', x: 150, y: 250, version: 3 }
		});
		socket.receive({
			v: 2,
			op: 'spectrum.moved',
			payload: { revision: 11, memberId: 'a', x: 160, y: 260, version: 4 }
		});
		expect(socket.sent).toHaveLength(count + 1);
		expect(JSON.parse(socket.sent.at(-1)!).op).toBe('spectrum.get');
		client.destroy();
	});
	it('refreshes spectrum independently without replacing note drafts', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.receive({ v: 2, op: 'spectrum.invalidate', payload: {} });
		expect(JSON.parse(socket.sent.at(-1)!).op).toBe('spectrum.get');
		const spectrum = { topic: 'Discussion', sliceCount: 7, hidden: true, pellets: [] };
		socket.receive({ v: 2, op: 'spectrum.snapshot', payload: spectrum });
		expect(callbacks.spectrum).toHaveBeenCalledWith(spectrum);
		expect(callbacks.snapshot).not.toHaveBeenCalled();
		client.destroy();
	});
	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('waits for signin acknowledgment before joining and sending v2 operations', () => {
		const { client, socket } = fixture();
		expect(client.send('note.create')).toBe(false);
		expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([
			{ procedure: 'signin', arguments: ['anonymous-user'] }
		]);
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		expect(JSON.parse(socket.sent[1])).toEqual({
			v: 2,
			op: 'room.join',
			payload: { roomId: 'ROOM' }
		});
		client.destroy();
	});

	it('requests authoritative snapshots for invalidation, including empty snapshots', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.receive({ v: 2, op: 'canvas.invalidate', payload: {} });
		expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ v: 2, op: 'canvas.get', payload: {} });
		socket.receive({
			v: 2,
			op: 'canvas.snapshot',
			payload: { revision: 3, notes: null, edges: null }
		});
		expect(callbacks.snapshot).toHaveBeenCalledWith({ revision: 3, notes: null, edges: null });
		client.destroy();
	});

	it('clears disconnected state, reconnects to same room, and cancels retry on destroy', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.close();
		expect(callbacks.snapshot).toHaveBeenCalledWith({ revision: 0, notes: [], edges: [] });
		expect(client.send('note.create')).toBe(false);
		vi.advanceTimersByTime(2000);
		expect(FakeSocket.instances).toHaveLength(2);
		const next = FakeSocket.instances[1];
		next.onopen?.();
		next.receive({ procedure: 'ack', arguments: ['signin'] });
		expect(JSON.parse(next.sent.at(-1)!)).toEqual({
			v: 2,
			op: 'room.join',
			payload: { roomId: 'ROOM' }
		});
		next.close();
		client.destroy();
		vi.advanceTimersByTime(10000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('resynchronizes rejected moves without looping on not_in_room errors', () => {
		const { client, socket, callbacks } = fixture();
		socket.receive({ procedure: 'ack', arguments: ['signin'] });
		socket.receive({ v: 2, op: 'error', payload: { code: 'forbidden', message: 'Not allowed' } });
		expect(callbacks.error).toHaveBeenCalledWith('Not allowed');
		expect(JSON.parse(socket.sent.at(-1)!).op).toBe('canvas.get');
		const count = socket.sent.length;
		socket.receive({ v: 2, op: 'error', payload: { code: 'not_in_room', message: 'No room' } });
		expect(socket.sent).toHaveLength(count);
		client.destroy();
	});
});
