import { Circle, FabricText, Group, Rect } from 'fabric';

export function newPellet(userId: string, nickname: string) {
	const circle = new Circle({
		top: 0,
		left: 0,
		radius: 12,
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
		left: circle.left + circle.radius + 4,
		top: 0,
		fontSize: 14,
		fill: '#ffffff',
		evented: false,
		originY: 'center',
		hasBorders: false,
		hasContext: false
	});

	const rect = new Rect({
		left: circle.left + circle.radius - 10,
		top: 0,
		width: text.width + 20,
		height: text.height + 10,
		fill: `#${userId}`,
		originY: 'center',
		strokeWidth: 3,
		strokeUniform: true,
		evented: false,
		hasBorders: false,
		hasContext: false
	});

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
