import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import CurrentOpinion from './CurrentOpinion.svelte';
import type { RoomState, SpectrumState } from './room-client';
import { cellLabel, type SpectrumCell } from './cells';
import { m } from '$lib/paraglide/messages.js';

const room = { roomId: 'room-a', userId: 'self', role: 'participant' } as RoomState;
function board(x = 100): SpectrumState {
	return {
		revision: 1,
		topic: 'Proposition',
		sliceCount: 7,
		hidden: false,
		pellets: [
			{ memberId: 'self', nickname: 'Self', color: 'ffffff', x, y: 100, version: 1 },
			{ memberId: 'other', nickname: 'Other', color: 'ffffff', x: 800, y: 100, version: 1 }
		]
	};
}
const detect = (x: number): SpectrumCell | null =>
	x < 0 ? null : { id: x > 500 ? 'agree' : 'disagree', path: '' };
function setup(overrides = {}) {
	const focusPellet = vi.fn();
	return {
		...render(CurrentOpinion, {
			room,
			spectrum: board(),
			detect,
			ready: true,
			focusPellet,
			...overrides
		}),
		focusPellet
	};
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

it('reads only the current member and announces a settled cell', async () => {
	const view = setup();
	expect(view.getByTestId('current-opinion')).toHaveTextContent(cellLabel('disagree'));
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
	await vi.advanceTimersByTimeAsync(400);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent(
		m.ux_opinion_current({ opinion: cellLabel('disagree') })
	);
	await view.rerender({ spectrum: board(800) });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(cellLabel('agree'));
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
	await vi.advanceTimersByTimeAsync(200);
	await view.rerender({ spectrum: board(100) });
	await vi.advanceTimersByTimeAsync(400);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent(
		m.ux_opinion_current({ opinion: cellLabel('disagree') })
	);
});

it('requires explicit confirmation, sends only coordinates and waits for the server readout', async () => {
	const choose = vi.fn(() => true);
	const view = setup({ choices: [{ id: 'agree', x: 700, y: 100 }], choose });
	await fireEvent.click(view.getByLabelText(m.ux_opinion_help()));
	await fireEvent.change(view.getByTestId('opinion-choice'), { target: { value: 'agree' } });
	expect(choose).not.toHaveBeenCalled();
	await fireEvent.submit(view.getByTestId('opinion-choice').closest('form')!);
	expect(choose).toHaveBeenCalledExactlyOnceWith({ x: 700, y: 100 });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(cellLabel('disagree'));
	await view.rerender({ spectrum: board(800) });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(cellLabel('agree'));
});

it('invalidates a pending choice on reconnect or proposition changes', async () => {
	const choose = vi.fn(() => true);
	const view = setup({ choices: [{ id: 'agree', x: 700, y: 100 }], choose });
	await fireEvent.click(view.getByLabelText(m.ux_opinion_help()));
	await fireEvent.change(view.getByTestId('opinion-choice'), { target: { value: 'agree' } });
	await view.rerender({ ready: false });
	expect(view.getByTestId('opinion-choice')).toHaveValue('');
	expect(view.getByTestId('opinion-choice-confirm')).toBeDisabled();
	expect(choose).not.toHaveBeenCalled();
});

it('does not reset an announcement when only coordinates within the same cell change', async () => {
	const view = setup();
	await vi.advanceTimersByTimeAsync(400);
	await view.rerender({ spectrum: board(150) });
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent(cellLabel('disagree'));
});

it('removes stale opinion immediately on disconnect and fences the pending announcement', async () => {
	const view = setup();
	await vi.advanceTimersByTimeAsync(200);
	await view.rerender({ ready: false, spectrum: null });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(m.ux_opinion_offline());
	await vi.advanceTimersByTimeAsync(500);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
	await fireEvent.click(view.getByLabelText(m.ux_opinion_help()));
	expect(view.getByRole('button', { name: m.ux_opinion_focus() })).toBeDisabled();
});

it('never exposes an old own opinion after becoming a spectator', async () => {
	const view = setup();
	await view.rerender({ room: { ...room, role: 'spectator' } });
	await vi.advanceTimersByTimeAsync(500);
	expect(view.queryByTestId('current-opinion')).toBeNull();
});

it('distinguishes loading and outside geometry without inventing a vote', async () => {
	const view = setup({ detect: null });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(m.ux_opinion_unavailable());
	await view.rerender({ detect, spectrum: board(-1) });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(m.ux_opinion_outside());
	await view.rerender({ spectrum: { ...board(), pellets: [] } });
	expect(view.getByTestId('current-opinion')).toHaveTextContent(m.ux_opinion_unavailable());
});

it('clears queued announcements on room/proposition changes and unmount', async () => {
	const view = setup();
	await vi.advanceTimersByTimeAsync(200);
	await view.rerender({
		room: { ...room, roomId: 'room-b', userId: 'new-self' },
		spectrum: board(800)
	});
	await vi.advanceTimersByTimeAsync(500);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
	view.unmount();
	await tick();
	expect(vi.getTimerCount()).toBe(0);
});

it('replaces a queued old-proposition announcement and cancels it while geometry loads', async () => {
	const view = setup();
	await vi.advanceTimersByTimeAsync(200);
	await view.rerender({ spectrum: { ...board(800), revision: 2, topic: 'New proposition' } });
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
	await vi.advanceTimersByTimeAsync(400);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent(cellLabel('agree'));
	await view.rerender({ detect: null });
	await vi.advanceTimersByTimeAsync(400);
	expect(view.getByTestId('opinion-announcement')).toHaveTextContent('');
});

it('offers a focus action without moving or publishing any opinion', async () => {
	const view = setup();
	await fireEvent.click(view.getByLabelText(m.ux_opinion_help()));
	await fireEvent.click(view.getByRole('button', { name: m.ux_opinion_focus() }));
	expect(view.focusPellet).toHaveBeenCalledOnce();
});
