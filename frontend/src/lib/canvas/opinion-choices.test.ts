import { expect, it } from 'vitest';
import { opinionChoices } from './opinion-choices';
import type { SpectrumCell } from './cells';

it('chooses a real interior sample even when the mean lies in a hole', () => {
	const cells: SpectrumCell[] = [
		{ id: 'agree', path: '' },
		{ id: 'neutral', path: '' }
	];
	const detect = (x: number, y: number) => {
		const distance = Math.hypot(x - 490, y - 350);
		return distance > 120 && distance < 200 ? cells[0] : distance < 50 ? cells[1] : null;
	};
	const choices = opinionChoices(cells, detect);
	expect(choices).toHaveLength(2);
	for (const choice of choices) {
		expect(detect(choice.x, choice.y)?.id).toBe(choice.id);
		expect(choice.x).toBeGreaterThanOrEqual(14);
		expect(choice.x).toBeLessThanOrEqual(966);
	}
});

it('never invents a target for hidden or missing cells', () => {
	expect(opinionChoices([], () => null)).toEqual([]);
	expect(opinionChoices([{ id: 'neutral', path: '' }], () => null)).toEqual([]);
});
