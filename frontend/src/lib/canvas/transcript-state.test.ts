import { describe, expect, it } from 'vitest';
import { mergeTranscript, type TranscriptSegment } from './transcript-state';

const segment = (sequence: number, text = 'Bonjour'): TranscriptSegment => ({
	roomId: 'room',
	id: 'utterance',
	sequence,
	speakerId: 'm_speaker',
	speakerName: 'Speaker',
	text,
	start: 0,
	end: 1000,
	language: 'fr',
	final: sequence > 1
});

describe('transcript merging', () => {
	it('keeps withdrawal tombstones so old snapshots cannot revive rejected text', () => {
		const draft = mergeTranscript(null, { sequence: 1, segments: [segment(1, 'Rejected text')] });
		const removed = mergeTranscript(draft, {
			sequence: 2,
			segments: [{ ...segment(2, ''), discarded: true }]
		});
		const stale = mergeTranscript(removed, {
			sequence: 1,
			segments: [segment(1, 'Rejected text')]
		});
		expect(stale.segments[0].discarded).toBe(true);
		expect(stale.segments[0].text).toBe('');
	});
	it('replaces partials without duplicating utterances', () => {
		const initial = mergeTranscript(null, { sequence: 1, segments: [segment(1, 'Bon')] });
		const final = mergeTranscript(initial, { sequence: 2, segments: [segment(2)] });
		expect(final.segments).toEqual([segment(2)]);
	});
	it('ignores snapshots older than live final text', () => {
		const live = mergeTranscript(null, { sequence: 2, segments: [segment(2)] });
		expect(mergeTranscript(live, { sequence: 1, segments: [segment(1)] })).toEqual(live);
	});
	it('accepts empty snapshots', () => {
		expect(mergeTranscript(null, { sequence: 0, segments: null })).toEqual({
			sequence: 0,
			segments: []
		});
	});
});
