import { Circle, FabricText, Group, Rect } from 'fabric';

const RADIUS = 12;
const FONT_SIZE = 14;

export function newPellet(userId: string, nickname: string) {
	// In Fabric 7, Group recalculates child positions relative to the group center.
	// We position everything so the group's visual center aligns with what we want.
	// Y=0 is the vertical center. X=0 is the left edge of the circle.

	const circle = new Circle({
		left: RADIUS, // center of circle
		top: 0,       // vertical center
		radius: RADIUS,
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

	// Measure text width first (before adding to group)
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

	const rectWidth = (text.width ?? 60) + 16;
	const rectHeight = RADIUS * 2;

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

	// Position rect right of circle (circle occupies -RADIUS to +RADIUS in x from its center)
	// We set positions here; Fabric 7 will offset them relative to the computed group center
	rect.set({ left: RADIUS * 2, top: 0 });
	text.set({ left: RADIUS * 2 + 8, top: 0 });

	const g = new Group([rect, text, circle], {
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
