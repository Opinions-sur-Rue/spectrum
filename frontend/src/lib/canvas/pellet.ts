import { Circle, FabricText, Group, Rect } from 'fabric';

export const PELLET_RADIUS = 12;
const FONT_SIZE = 14;

export function newPellet(userId: string, nickname: string) {
	// In Fabric 7, Group recalculates child positions relative to the group center.
	// We use originX/Y='center' and balance the bbox so that group.left/top = circle center.

	const circle = new Circle({
		left: PELLET_RADIUS, // center of circle at x=PELLET_RADIUS
		top: 0,
		radius: PELLET_RADIUS,
		originX: 'center',
		originY: 'center',
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
		fontSize: FONT_SIZE,
		fill: '#ffffff',
		evented: false,
		originX: 'left',
		originY: 'center',
		hasBorders: false,
		hasContext: false
	});

	const rectWidth = (text.width ?? 60) + PELLET_RADIUS + 20;
	const rectHeight = PELLET_RADIUS * 2;

	const rect = new Rect({
		width: rectWidth,
		height: rectHeight,
		fill: `#${userId}`,
		originX: 'left',
		originY: 'center',
		strokeWidth: 0,
		evented: false,
		hasBorders: false,
		hasContext: false
	});

	rect.set({ left: PELLET_RADIUS, top: 0 });
	text.set({ left: PELLET_RADIUS * 2 + 8, top: 0 });

	// Invisible element that mirrors the rect's extent to the left of the circle center,
	// so the bbox is symmetric around x=PELLET_RADIUS and originX='center' = circle center.
	const balancer = new Rect({
		width: 1,
		height: 1,
		left: PELLET_RADIUS - rectWidth,
		originX: 'left',
		originY: 'center',
		opacity: 0,
		evented: false,
		hasBorders: false,
		hasControls: false
	});

	const g = new Group([balancer, rect, text, circle], {
		originX: 'center',
		originY: 'center',
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
