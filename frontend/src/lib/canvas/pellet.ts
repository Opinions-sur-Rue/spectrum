import { Circle, FabricText, Group, Rect } from 'fabric';

const RADIUS = 12;

export function newPellet(userId: string, nickname: string) {
	// All objects use originX: 'left', originY: 'top' (explicit, Fabric 6 behavior)
	// Circle center is at (RADIUS, RADIUS) so it sits at top-left of bounding box
	const circle = new Circle({
		left: 0,
		top: 0,
		radius: RADIUS,
		originX: 'left',
		originY: 'top',
		fill: `#f9f9f9`,
		stroke: `#${userId}`,
		strokeWidth: 5,
		strokeUniform: true,
		evented: false,
		hasControls: false,
		hasBorders: false
	});

	const text = new FabricText(nickname, {
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		left: RADIUS * 2 + 8, // right of the circle + small gap
		top: 0,
		fontSize: 14,
		fill: '#ffffff',
		originX: 'left',
		originY: 'top',
		evented: false,
		hasBorders: false,
		hasContext: false
	});

	const rect = new Rect({
		left: RADIUS * 2, // starts right after the circle
		top: 0,
		width: (text.width ?? 0) + 16,
		height: RADIUS * 2,
		fill: `#${userId}`,
		originX: 'left',
		originY: 'top',
		strokeWidth: 0,
		evented: false,
		hasBorders: false,
		hasContext: false
	});

	const g = new Group([rect, text, circle], {
		originX: 'left',
		originY: 'top',
		evented: false,
		hasBorders: false,
		hasControls: false
	});

	g.on({
		mouseover: () => {
			rect.set({ opacity: 1 });
			text.set({ opacity: 1 });
		},
		mouseout: () => {
			rect.set({ opacity: 0.5 });
			text.set({ opacity: 0.5 });
		}
	});

	return g;
}
