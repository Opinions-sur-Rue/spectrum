import { floatingLayout, visibleViewport } from './floating-layout';

/** Dismiss transient popovers and keep them inside the visible viewport. */
export function toolbarMenu(node: HTMLDetailsElement) {
	node.name = 'room-toolbar';
	let frame = 0;
	const panel = node.querySelector<HTMLElement>('.toolbar-popover');
	const summary = node.querySelector('summary');
	function position() {
		frame = 0;
		if (!node.open || !panel || !summary) return;
		const bounds = visibleViewport();
		panel.style.position = 'fixed';
		panel.style.right = 'auto';
		panel.style.bottom = 'auto';
		panel.style.boxSizing = 'border-box';
		panel.style.maxWidth = `${Math.max(1, bounds.width - 16)}px`;
		panel.style.maxHeight = `${Math.max(1, bounds.height - 16)}px`;
		panel.style.overflowY = 'auto';
		panel.style.overflowX = 'hidden';
		panel.style.overflowWrap = 'anywhere';
		const size = panel.getBoundingClientRect();
		const layout = floatingLayout(summary.getBoundingClientRect(), size, bounds);
		panel.style.left = `${layout.x}px`;
		panel.style.top = `${layout.y}px`;
	}
	function schedule() {
		if (!frame) frame = requestAnimationFrame(position);
	}
	const resize = new ResizeObserver(schedule);
	if (panel) resize.observe(panel);
	resize.observe(node);
	node.addEventListener('toggle', schedule);
	window.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	function outside(event: Event) {
		if (node.open && event.target instanceof Node && !node.contains(event.target))
			node.open = false;
	}
	function keyboard(event: KeyboardEvent) {
		if (node.open && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			node.open = false;
			node.querySelector('summary')?.focus();
		}
	}
	document.addEventListener('pointerdown', outside);
	document.addEventListener('focusin', outside);
	node.addEventListener('keydown', keyboard);
	return {
		destroy() {
			cancelAnimationFrame(frame);
			resize.disconnect();
			node.removeEventListener('toggle', schedule);
			window.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('scroll', schedule);
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('focusin', outside);
			node.removeEventListener('keydown', keyboard);
		}
	};
}
