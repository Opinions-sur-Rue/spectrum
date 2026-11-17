import { expect, it } from 'vitest';
import { formatSpeakingTime, speakingSecondsFor } from './speaking-time';

it('formats short, exact-minute and mixed durations compactly', () => {
	expect(formatSpeakingTime(0)).toBe('0 s');
	expect(formatSpeakingTime(59.9)).toBe('59 s');
	expect(formatSpeakingTime(60)).toBe('1 min');
	expect(formatSpeakingTime(65)).toBe('1 min 05 s');
	expect(formatSpeakingTime(3600)).toBe('60 min');
	expect(formatSpeakingTime(-4)).toBe('0 s');
});

it('keeps the newest server total over a stale room snapshot', () => {
	const updates = { m_a: 42, m_b: 0 };
	expect(speakingSecondsFor('m_a', 10, updates)).toBe(42);
	expect(speakingSecondsFor('m_a', 50, updates)).toBe(50);
	expect(speakingSecondsFor('m_missing', undefined, updates)).toBe(0);
});
