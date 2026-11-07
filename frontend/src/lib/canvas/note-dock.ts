import { floatingLayout } from './floating-layout';

/** Keep the existing, world-space dock inside the canvas without cloning editors. */
export function noteDock(node: HTMLElement) {
	const card = node.closest<HTMLElement>('.note-card');
	const canvas = node.closest<HTMLElement>('.canvas-area');
	const world = card?.parentElement;
	if (!card || !canvas || !world) return;
	let frame = 0;
	let disposed = false;
	let pressing = false;
	function reset() {
		for (const property of ['--dock-top', '--dock-left', '--dock-width', '--dock-height'])
			node.style.removeProperty(property);
		card!.removeAttribute('data-dock-placement');
	}
	function update() {
		frame = 0;
		if (disposed || pressing) return;
		if (getComputedStyle(node).position !== 'absolute') {
			reset();
			return;
		}
		if (!card!.matches(':hover, :focus-within') || !node.children.length) return;
		const anchor = card!.getBoundingClientRect();
		const viewport = canvas!.getBoundingClientRect();
		const scale = anchor.width / card!.offsetWidth;
		if (!(scale > 0) || viewport.width <= 0 || viewport.height <= 0) return;
		// Leave navigation/status controls unobscured at the bottom of the canvas.
		const bounds = {
			x: viewport.x,
			y: viewport.y,
			width: viewport.width,
			height: Math.max(1, viewport.height - 60)
		};
		const width = Math.max(1, Math.min(anchor.width, bounds.width - 16));
		node.style.setProperty('--dock-width', `${width / scale}px`);
		node.style.setProperty('--dock-height', `${Math.max(1, bounds.height - 16) / scale}px`);
		const layout = floatingLayout(
			anchor,
			{ width, height: node.scrollHeight * scale },
			bounds,
			'center',
			10
		);
		node.style.setProperty('--dock-left', `${(layout.x - anchor.x) / scale}px`);
		node.style.setProperty('--dock-top', `${(layout.y - anchor.y) / scale}px`);
		card!.dataset.dockPlacement = layout.side;
	}
	function schedule() {
		if (!disposed && !frame) frame = requestAnimationFrame(update);
	}
	function press() {
		// Focus exposes advanced controls, changing the dock height. Do not move
		// an above-card dock between pointerdown and click or the click is lost.
		pressing = true;
	}
	function release() {
		if (!pressing) return;
		pressing = false;
		schedule();
	}
	const resize = new ResizeObserver(schedule);
	for (const element of [node, card, canvas]) resize.observe(element);
	const changes = new MutationObserver(schedule);
	changes.observe(card, { attributes: true, attributeFilter: ['style', 'class'] });
	changes.observe(world, { attributes: true, attributeFilter: ['style'] });
	card.addEventListener('pointerenter', schedule);
	card.addEventListener('focusin', schedule);
	node.addEventListener('pointerdown', press, true);
	window.addEventListener('pointerup', release);
	window.addEventListener('pointercancel', release);
	window.addEventListener('resize', schedule);
	schedule();
	return {
		destroy() {
			disposed = true;
			cancelAnimationFrame(frame);
			resize.disconnect();
			changes.disconnect();
			card.removeEventListener('pointerenter', schedule);
			card.removeEventListener('focusin', schedule);
			node.removeEventListener('pointerdown', press, true);
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
			window.removeEventListener('resize', schedule);
			reset();
		}
	};
}
