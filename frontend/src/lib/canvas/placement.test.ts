import { describe, expect, it } from 'vitest';
import { nextNotePosition, revealNote } from './placement';
import { worldToScreen } from './camera';
import type { NoteModel } from './models';

describe('note placement beside spectrum', () => {
	it('keeps first notes off the spectrum and apart', () => {
		const camera = { x: 0, y: 0, scale: 1 };
		const first = nextNotePosition(camera, []);
		expect(first.x >= 490 || first.x + 360 <= -490).toBe(true);
		const note: NoteModel = {
			id: 'first',
			...first,
			width: 360,
			height: 340,
			title: '',
			markdown: '',
			color: '',
			moderation: 'approved',
			visible: false,
			authorId: ''
		};
		const second = nextNotePosition(camera, [note]);
		expect(second.x >= 490 || second.x + 360 <= -490).toBe(true);
		expect(second).not.toEqual(first);
		expect(Math.abs(second.x - first.x)).toBeGreaterThan(360);
	});
	it('uses the camera center when far from the spectrum', () => {
		expect(nextNotePosition({ x: 2000, y: 1000, scale: 1 }, [])).toEqual({ x: 1820, y: 830 });
	});
	it('keeps note rectangles within world bounds near an edge', () => {
		const point = nextNotePosition({ x: 5999, y: 3999, scale: 1 }, []);
		expect(point.x).toBeGreaterThanOrEqual(-6000);
		expect(point.x + 360).toBeLessThanOrEqual(6000);
		expect(point.y).toBeGreaterThanOrEqual(-4000);
		expect(point.y + 340).toBeLessThanOrEqual(4000);
	});
	it('reveals a new card and controls without changing zoom unnecessarily', () => {
		const viewport = { width: 1400, height: 850 };
		const point = { x: 540, y: -170 };
		const camera = revealNote({ x: 0, y: 0, scale: 0.83 }, viewport, point);
		const top = worldToScreen(camera, viewport, { x: point.x, y: point.y - 30 });
		const bottom = worldToScreen(camera, viewport, { x: point.x + 360, y: point.y + 490 });
		expect(camera.scale).toBe(0.83);
		expect(top.x).toBeGreaterThanOrEqual(24);
		expect(top.y).toBeGreaterThanOrEqual(24);
		expect(bottom.x).toBeLessThanOrEqual(viewport.width - 24);
		expect(bottom.y).toBeLessThanOrEqual(viewport.height - 24);
	});
});
