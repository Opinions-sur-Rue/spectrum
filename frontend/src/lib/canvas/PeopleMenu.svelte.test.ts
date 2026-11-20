import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { m } from '$lib/paraglide/messages.js';
import PeopleMenu from './PeopleMenu.svelte';
import type { RoomState } from './room-client';

const name = 'Samira — participante ' + 'LongUnbrokenName'.repeat(8);

function room(role: RoomState['role'] = 'admin'): RoomState {
	return {
		userId: 'self',
		role,
		settings: { participantSlots: 5, spectatorLimit: 40 },
		voice: { available: true },
		members: [
			{ id: 'self', nickname: 'Host', role, color: 'abcdef' },
			{ id: 'participant', nickname: name, role: 'participant', speakingSeconds: 61 },
			{ id: 'coadmin', nickname: 'Co-admin', role: 'admin' },
			{ id: 'spectator', nickname: name + ' spectator', role: 'spectator' }
		]
	} as RoomState;
}

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		}))
	);
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.open = true;
		}
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
});

it('separates full names from metadata and actions for participants and spectators', () => {
	const view = render(PeopleMenu, { room: room(), ready: true, send: vi.fn() });
	for (const id of ['participant', 'spectator']) {
		const row = view.container.querySelector(`[data-member-id="${id}"]`)!;
		const identity = row.querySelector('.member-identity')!;
		const nickname = identity.querySelector('.member-name')!;
		expect(nickname.getAttribute('data-member-name')).toBe(id);
		expect(row.querySelector('.member-actions')?.getAttribute('data-member-actions')).toBe(id);
		expect(nickname.textContent).toBe(row.getAttribute('aria-label'));
		expect(nickname.classList.contains('truncate')).toBe(false);
		expect(identity.querySelector('button')).toBeNull();
		expect(row.querySelector('.member-actions')?.parentElement).toBe(row);
	}
	const participant = view.container.querySelector('[data-member-id="participant"]')!;
	expect(
		participant.querySelector('.member-meta [data-speaking-time="participant"]')
	).not.toBeNull();
	expect(participant.querySelector('.member-actions')?.querySelectorAll('button')).toHaveLength(4);
	expect(participant.querySelector('.member-audio')).toBeNull();
	expect(view.container.querySelector('.profile-form')?.parentElement).toBe(
		view.getByTestId('people-panel')
	);
	expect(view.container.querySelector('.people-heading')?.parentElement).toBe(
		view.getByTestId('people-panel')
	);
});

it('preserves moderation operations and confirmation before appointment', async () => {
	const send = vi.fn(() => true);
	const view = render(PeopleMenu, { room: room(), ready: true, send });
	await fireEvent.click(view.getByLabelText(m.voice_mute_member({ name })));
	expect(send).toHaveBeenLastCalledWith('voice.mute', { memberId: 'participant' });
	await fireEvent.click(view.getByLabelText(m.v2_demote({ name })));
	expect(send).toHaveBeenLastCalledWith('room.demote', { memberId: 'participant' });
	await fireEvent.click(view.getByLabelText(m.v2_promote({ name: name + ' spectator' })));
	expect(send).toHaveBeenLastCalledWith('room.promote', { memberId: 'spectator' });
	send.mockClear();
	await fireEvent.click(view.getByLabelText(m.v2_appoint_admin({ name })));
	expect(send).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	expect(send).toHaveBeenCalledWith('room.appoint', { memberId: 'participant' });
});

it('searches names without changing counts and distinguishes duplicate moderation targets', async () => {
	const state = room();
	state.members = [
		{ id: 'self', nickname: 'Host', role: 'admin' },
		{ id: 'a', nickname: 'Alex', role: 'participant' },
		{ id: 'b', nickname: 'Alex', role: 'spectator' }
	];
	const send = vi.fn(() => true);
	const view = render(PeopleMenu, { room: state, ready: true, send });
	await fireEvent.input(view.getByTestId('people-search'), { target: { value: 'alex' } });
	expect(view.container.querySelector('[data-member-id="self"]')).toBeNull();
	expect(view.container.querySelectorAll('[data-member-id]')).toHaveLength(2);
	await fireEvent.click(view.getByLabelText(m.v2_promote({ name: 'Alex · 2' })));
	expect(send).toHaveBeenCalledWith('room.promote', { memberId: 'b' });
	await fireEvent.input(view.getByTestId('people-search'), { target: { value: 'missing' } });
	expect(view.getByText(m.ux_people_search_empty())).toHaveTextContent(m.ux_people_search_empty());
});

it('keeps non-admin rows free of empty action and audio rows', () => {
	const view = render(PeopleMenu, { room: room('participant'), ready: true, send: vi.fn() });
	expect(view.container.querySelector('.member-actions')).toBeNull();
	expect(view.container.querySelector('.member-audio')).toBeNull();
	const row = view.container.querySelector('[data-member-id="participant"]') as HTMLElement;
	expect(within(row).queryByRole('button')).toBeNull();
});

it('retains co-admin abdication and never offers remote unmute', async () => {
	const initial = room();
	initial.members = initial.members.map((member) =>
		member.id === 'participant' ? { ...member, microphoneMuted: true } : member
	);
	const send = vi.fn(() => true);
	const view = render(PeopleMenu, { room: initial, ready: true, send });
	expect((view.getByLabelText(m.voice_mute_member({ name })) as HTMLButtonElement).disabled).toBe(
		true
	);
	await fireEvent.click(view.getByLabelText(m.v2_abdicate_admin()));
	expect(send).not.toHaveBeenCalled();
	await fireEvent.click(view.getByTestId('confirm-session-action'));
	expect(send).toHaveBeenCalledWith('room.abdicate', {});
	const coadmin = view.container.querySelector('[data-member-id="coadmin"]')!;
	expect(coadmin.querySelector('.member-actions')).toBeNull();
});

it('cancels stale kick confirmation after target leaves', async () => {
	const send = vi.fn(() => true);
	const initial = room();
	const view = render(PeopleMenu, { room: initial, ready: true, send });
	await fireEvent.click(view.getByLabelText(m.session_kick({ name })));
	expect(view.getByTestId('confirm-session-action')).toBeTruthy();
	await view.rerender({
		room: { ...initial, members: initial.members.filter((member) => member.id !== 'participant') }
	});
	expect(view.queryByTestId('confirm-session-action')).toBeNull();
	expect(send).not.toHaveBeenCalled();
});
