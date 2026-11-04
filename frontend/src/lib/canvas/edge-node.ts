import Konva from 'konva';
import type { Point } from './camera';
import type { EdgeModel, Relation } from './models';

export const RELATION_COLORS: Record<Relation, string> = {
	supports: '#22c55e',
	contradicts: '#ef4444',
	questions: '#3b82f6',
	extends: '#a855f7',
	related: '#9ca3af'
};

/**
 * Builds the arrow of an edge. It is not listening: clicking an edge is not a
 * v2 interaction yet, and non-listening arrows let the stage pan underneath.
 */
export function createEdgeLine(edge: EdgeModel, from: Point, to: Point): Konva.Group {
	const color = RELATION_COLORS[edge.relation];

	const group = new Konva.Group({ name: 'edge', listening: false });

	group.add(
		new Konva.Arrow({
			points: [from.x, from.y, to.x, to.y],
			stroke: color,
			fill: color,
			strokeWidth: 2,
			pointerLength: 10,
			pointerWidth: 9,
			dash: edge.relation === 'questions' ? [8, 6] : undefined,
			opacity: 0.85
		})
	);

	return group;
}
