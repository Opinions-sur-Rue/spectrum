export interface ScreenRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** All inputs and outputs are screen CSS pixels, independent of canvas scale. */
export function floatingLayout(
	anchor: ScreenRect,
	panel: { width: number; height: number },
	bounds: ScreenRect,
	align: 'center' | 'end' = 'end',
	gap = 8
) {
	const margin = Math.max(0, Math.min(8, (bounds.width - 1) / 2, (bounds.height - 1) / 2));
	const left = bounds.x + margin;
	const top = bounds.y + margin;
	const width = Math.max(1, Math.min(panel.width, bounds.width - margin * 2));
	const height = Math.max(1, Math.min(panel.height, bounds.height - margin * 2));
	const right = Math.max(left, bounds.x + bounds.width - margin - width);
	const bottom = Math.max(top, bounds.y + bounds.height - margin - height);
	const below = anchor.y + anchor.height + gap;
	const above = anchor.y - gap - height;
	const belowSpace = bounds.y + bounds.height - margin - below;
	const aboveSpace = anchor.y - gap - top;
	const side = belowSpace >= height || belowSpace >= aboveSpace ? 'below' : 'above';
	const desiredX =
		align === 'center' ? anchor.x + (anchor.width - width) / 2 : anchor.x + anchor.width - width;
	return {
		x: Math.max(left, Math.min(right, desiredX)),
		y: Math.max(top, Math.min(bottom, side === 'below' ? below : above)),
		width,
		height,
		side
	};
}

export function visibleViewport(): ScreenRect {
	const viewport = window.visualViewport;
	return {
		x: viewport?.offsetLeft ?? 0,
		y: viewport?.offsetTop ?? 0,
		width: viewport?.width ?? window.innerWidth,
		height: viewport?.height ?? window.innerHeight
	};
}
