export interface TranscriptSegment {
	roomId: string;
	id: string;
	sequence: number;
	speakerId: string;
	speakerName: string;
	text: string;
	start: number;
	end: number;
	language: string;
	final: boolean;
	discarded?: boolean;
	source?: 'browser';
}
export interface TranscriptState {
	sequence: number;
	segments: TranscriptSegment[];
}

export function mergeTranscript(
	current: TranscriptState | null,
	incoming: { sequence: number; segments: TranscriptSegment[] | null }
): TranscriptState {
	const segments = new Map((current?.segments ?? []).map((segment) => [segment.id, segment]));
	for (const segment of incoming.segments ?? []) {
		const previous = segments.get(segment.id);
		if (!previous || previous.sequence < segment.sequence) segments.set(segment.id, segment);
	}
	return {
		sequence: Math.max(current?.sequence ?? 0, incoming.sequence),
		segments: [...segments.values()]
			.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
			.slice(-5000)
	};
}
