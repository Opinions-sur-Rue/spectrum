import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMovementStream } from './movement-stream';

describe('live movement stream', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());
	it('sends during the gesture and coalesces bursts to 20Hz', () => {
		const send = vi.fn();
		const stream = createMovementStream(send);
		stream.update({ x: 10, y: 20 });
		expect(send).toHaveBeenCalledWith({ x: 10, y: 20 });
		for (let x = 11; x <= 30; x++) stream.update({ x, y: 20 });
		expect(send).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(50);
		expect(send).toHaveBeenLastCalledWith({ x: 30, y: 20 });
		expect(send).toHaveBeenCalledTimes(2);
	});
	it('flushes the exact final point and removes the trailing timer', () => {
		const send = vi.fn();
		const stream = createMovementStream(send);
		stream.update({ x: 1, y: 2 });
		stream.update({ x: 3, y: 4 });
		stream.finish({ x: 5, y: 6 });
		vi.advanceTimersByTime(100);
		expect(send.mock.calls).toEqual([[{ x: 1, y: 2 }], [{ x: 5, y: 6 }]]);
	});
	it('drops queued messages when unmounted or demoted', () => {
		const send = vi.fn();
		const stream = createMovementStream(send);
		stream.update({ x: 1, y: 2 });
		stream.update({ x: 3, y: 4 });
		stream.cancel();
		vi.advanceTimersByTime(100);
		expect(send).toHaveBeenCalledTimes(1);
	});
});
