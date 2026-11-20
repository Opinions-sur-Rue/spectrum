import { expect, it } from 'vitest';
import { placePelletLabels, participantNames } from './pellet-labels';

it('disambiguates duplicate nicknames deterministically without changing identities', () => {
	const members = [
		{ id: 'b', nickname: 'Alex' },
		{ id: 'a', nickname: 'Alex' },
		{ id: 'c', nickname: 'Sam' }
	];
	expect(participantNames(members)).toEqual({ a: 'Alex · 1', b: 'Alex · 2', c: 'Sam' });
	expect(participantNames([...members].reverse())).toEqual(participantNames(members));
	expect(members[0].nickname).toBe('Alex');
});

it('keeps the own name first, bounds crowded labels and never changes anchors', () => {
	const anchors = Array.from({ length: 40 }, (_, i) => ({ id: `m_${i}`, x: 100, y: 100 }));
	const original = structuredClone(anchors);
	const labels = placePelletLabels(anchors, 'm_39');
	expect(labels.m_39).toEqual({ lift: 0, hidden: false });
	expect(Object.values(labels).filter((item) => !item.hidden)).toHaveLength(4);
	expect(Math.max(...Object.values(labels).map((item) => item.lift))).toBe(84);
	expect(anchors).toEqual(original);
	expect(placePelletLabels([...anchors].reverse(), 'm_39')).toEqual(labels);
});

it('keeps separated labels on their original line', () => {
	expect(
		placePelletLabels(
			[
				{ id: 'a', x: 10, y: 10 },
				{ id: 'b', x: 300, y: 10 }
			],
			'a'
		)
	).toEqual({
		a: { lift: 0, hidden: false },
		b: { lift: 0, hidden: false }
	});
});
