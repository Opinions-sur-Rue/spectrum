import { describe, expect, it } from 'vitest';
import { RoomCountdown, timerDuration, timerLabel } from './room-timer';

describe('shared countdown', () => {
	it('uses the server deadline even when local clocks disagree', () => {
		const clock = new RoomCountdown();
		clock.update({ revision: 1, durationSeconds: 60, endsAt: 90000, serverNow: 30000 }, 500);
		expect(clock.seconds(500)).toBe(60);
		expect(clock.seconds(1500)).toBe(59);
		expect(clock.seconds(60500)).toBe(0);
		expect(clock.seconds(999999)).toBe(0);
	});
	it('restores remaining time on a late join or after a background-tab delay', () => {
		const clock = new RoomCountdown();
		clock.update({ revision: 1, durationSeconds: 60, endsAt: 90000, serverNow: 85000 }, 100);
		expect(clock.seconds(100)).toBe(5);
		expect(clock.seconds(5100)).toBe(0);
		clock.update({ revision: 1, durationSeconds: 60, endsAt: 90000, serverNow: 95000 }, 5100);
		expect(clock.seconds(5100)).toBe(0);
	});
	it('rejects stale timers and supports cancellation and restart', () => {
		const clock = new RoomCountdown();
		clock.update({ revision: 2, durationSeconds: 0, endsAt: 0, serverNow: 10000 }, 50);
		expect(
			clock.update({ revision: 1, durationSeconds: 60, endsAt: 70000, serverNow: 10000 }, 50)
		).toBe(false);
		expect(clock.seconds(50)).toBe(0);
		clock.update({ revision: 3, durationSeconds: 60, endsAt: 70000, serverNow: 10000 }, 100);
		expect(clock.seconds(100)).toBe(60);
	});
	it('validates duration fields without treating blank or zero as cancel', () => {
		for (const [minutes, seconds] of [
			[undefined, 0],
			[0, undefined],
			[0, 0],
			[-1, 0],
			[1.5, 0],
			[0, 60],
			[1440, 1],
			[Infinity, 0]
		])
			expect(timerDuration(minutes, seconds)).toBeNull();
		expect(timerDuration(0, 1)).toBe(1);
		expect(timerDuration(5, 30)).toBe(330);
		expect(timerDuration(1440, 0)).toBe(86400);
	});
	it('formats minutes and hours', () => {
		expect(timerLabel(0)).toBe('0:00');
		expect(timerLabel(65)).toBe('1:05');
		expect(timerLabel(3661)).toBe('1:01:01');
	});
});
