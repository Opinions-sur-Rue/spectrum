import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from './activity-state';
import { activityLabel } from './activity-labels';

describe('activity labels', () => {
	it('names the shared claim consistently with the room vocabulary', () => {
		expect(
			activityLabel({
				id: 1,
				kind: 'topic',
				topic: 'Le vélo en ville',
				at: 0
			} as ActivityEntry)
		).toBe('Le claim est « Le vélo en ville »');
		expect(activityLabel({ id: 2, kind: 'topic', at: 0 } as ActivityEntry)).toBe(
			'Le claim a été effacé'
		);
	});
});
