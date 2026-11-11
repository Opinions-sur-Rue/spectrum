import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import RoomTimer from './RoomTimer.svelte';
import type { RoomState } from './room-client';

function room(role: RoomState['role'] = 'admin', endsAt = 5000): RoomState {
	return {
		roomId: 'timer-room',
		role,
		timer: { revision: 1, durationSeconds: 5, endsAt, serverNow: 0 }
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
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('offers configuration only to admins and refuses changes while disconnected', async () => {
	const send = vi.fn(() => true);
	const view = render(RoomTimer, { room: room('spectator'), ready: true, send });
	await tick();
	expect(view.queryByLabelText(m.timer_setup())).toBeNull();
	expect(view.getByRole('timer').textContent).toBe('0:05');
	await view.rerender({ room: room('participant'), ready: true, send });
	expect(view.queryByLabelText(m.timer_setup())).toBeNull();
	await view.rerender({ room: room(), ready: false, send });
	await fireEvent.submit(view.container.querySelector('form')!);
	expect(send).not.toHaveBeenCalled();
	await view.rerender({ room: room(), ready: true, send });
	await fireEvent.submit(view.container.querySelector('form')!);
	expect(send).toHaveBeenCalledWith('room.timer', { durationSeconds: 300 });
});

it('finishes once with a visual cue, without sound, and does not replay for late joins', async () => {
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
	const view = render(RoomTimer, { room: room('spectator'), ready: true, send: vi.fn() });
	await tick();
	await vi.advanceTimersByTimeAsync(5000);
	await tick();
	expect(view.getByRole('timer').textContent).toBe('0:00');
	expect(view.getByTestId('room-timer').getAttribute('data-finished')).toBe('true');
	expect(view.getByRole('status').textContent).toBe(m.timer_finished());
	expect(view.container.querySelector('audio')).toBeNull();
	await view.rerender({
		room: {
			...room('spectator'),
			timer: { revision: 1, durationSeconds: 5, endsAt: 5000, serverNow: 6000 }
		},
		ready: true,
		send: vi.fn()
	});
	expect(view.getByTestId('room-timer').getAttribute('data-finished')).toBe('true');
	cleanup();
	const late = render(RoomTimer, {
		room: {
			...room('spectator'),
			timer: { revision: 1, durationSeconds: 5, endsAt: 5000, serverNow: 6000 }
		},
		ready: true,
		send: vi.fn()
	});
	await tick();
	expect(late.getByRole('timer').textContent).toBe('0:00');
	expect(late.getByRole('status').textContent).toBe(m.timer_finished());
	expect(late.getByRole('status').classList.contains('sr-only')).toBe(false);
	expect(late.getByTestId('room-timer').getAttribute('data-finished')).toBe('false');
});

it('quick durations fill the form without starting or replacing the shared timer', async () => {
	const send = vi.fn(() => true);
	const view = render(RoomTimer, { room: room(), ready: true, send });
	await tick();
	await fireEvent.click(view.getByLabelText(m.timer_setup()));
	for (const preset of [1, 3, 5]) {
		await fireEvent.input(view.getByLabelText(m.timer_seconds()), { target: { value: '45' } });
		const button = view.getByRole('button', { name: m.timer_preset({ minutes: preset }) });
		await fireEvent.click(button);
		expect((view.getByLabelText(m.timer_minutes()) as HTMLInputElement).value).toBe(String(preset));
		expect((view.getByLabelText(m.timer_seconds()) as HTMLInputElement).value).toBe('0');
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(send).not.toHaveBeenCalled();
	}
	await fireEvent.submit(view.container.querySelector('form')!);
	expect(send).toHaveBeenCalledWith('room.timer', { durationSeconds: 300 });
	await view.rerender({ room: room(), ready: false, send });
	await fireEvent.click(view.getByLabelText(m.timer_setup()));
	for (const button of view
		.getByRole('group', { name: m.timer_presets() })
		.querySelectorAll('button'))
		expect(button.disabled).toBe(true);
});
