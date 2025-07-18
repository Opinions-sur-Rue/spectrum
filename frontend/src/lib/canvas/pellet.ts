import { Circle, FabricText, Group, Rect } from 'fabric';

export function oldPellet(colorHex: string, nickname: string) {
	const options = {
		top: 0,
		left: 0,
		radius: 12
	};

	const circle = new Circle({
		...options,
		fill: `#${colorHex}`,
		stroke: '#f9f9f9',
		strokeWidth: 3,
		strokeUniform: true,
		hasBorders: false,
		hasContext: false
	});

	const text = new FabricText(nickname, {
		fontFamily: 'monospace',
		left: circle.left + circle.radius + 20,
		top: circle.top - circle.radius - 11,
		fontSize: 14,
		fill: '#ffffff',
		hasBorders: false,
		hasContext: false,
		opacity: 0.5
	});

	const rect = new Rect({
		left: circle.left + circle.radius + 13,
		top: circle.top - circle.radius - 18,
		width: text.width + 10,
		height: text.height + 10,
		fill: `#${colorHex}`,
		stroke: '#e0e0e0',
		strokeWidth: 3,
		strokeUniform: true,
		hasBorders: false,
		hasContext: false,
		opacity: 0.5
	});

	const g = new Group([circle, rect, text], {
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

export function newPellet(userId: string, nickname: string /*, pictureUrl?: string*/) {
	const options = {
		top: 0,
		left: 0,
		radius: 12
	};

	const circle = new Circle({
		...options,
		originX: 'center',
		originY: 'center',
		fill: `#f9f9f9`,
		stroke: `#${userId}`, //'#f9f9f9',
		strokeWidth: 5,
		strokeUniform: true,
		evented: false,
		hasControls: false,
		hasBorders: false
	});

	/*const image = new FabricImage('pug', {
		top: 0,
		left: 0,
		evented: false,
		hasControls: false,
		hasBorders: false
	});

	image.scaleToWidth(options.radius * 2);

	// Set origin to center to match circle
	image.set({
		originX: 'center',
		originY: 'center'
	});

	const circleClip = new Circle({
		radius: options.radius / image.scaleX - 40,
		originX: 'center',
		originY: 'center',
		left: 0,
		top: 0
	});
	image.clipPath = circleClip;*/

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
		//stroke: '#e0e0e0',
		strokeWidth: 3,
		strokeUniform: true,
		evented: false,
		hasBorders: false,
		hasContext: false
	});

	const g = new Group([rect, text, circle /* image */], {
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
