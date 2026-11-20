import { floatingLayout, visibleViewport } from './floating-layout';

/** Dismiss transient popovers and keep them inside the visible viewport. */
interface ToolbarOptions {
	sheet?: boolean;
	close?: () => void;
}

export function toolbarMenu(node: HTMLDetailsElement, options: ToolbarOptions = {}) {
	node.name = 'room-toolbar';
	let frame = 0;
	const panel = node.querySelector<HTMLElement>('.toolbar-popover');
	const summary = node.querySelector('summary');
	function position() {
		frame = 0;
		if (!node.open || !panel || !summary) return;
		const bounds = visibleViewport();
		const sheet = options.sheet && window.matchMedia('(max-width: 1023px)').matches;
		const anchor = summary.getBoundingClientRect();
		const belowSpace = bounds.y + bounds.height - 8 - (anchor.y + anchor.height + 8);
		const aboveSpace = anchor.y - 8 - (bounds.y + 8);
		panel.style.position = 'fixed';
		panel.style.right = 'auto';
		panel.style.bottom = 'auto';
		panel.style.boxSizing = 'border-box';
		panel.style.maxWidth = `${Math.max(1, bounds.width - (sheet ? 0 : 16))}px`;
		// A tall popover must scroll on one side of its trigger, not cover it.
		panel.style.maxHeight = `${Math.max(1, sheet ? bounds.height : Math.min(bounds.height - 16, Math.max(belowSpace, aboveSpace)))}px`;
		panel.style.width = sheet ? `${bounds.width}px` : '';
		panel.style.height = sheet ? `${bounds.height}px` : '';
		panel.style.overflowY = options.sheet ? 'hidden' : 'auto';
		panel.style.overflowX = 'hidden';
		panel.style.overflowWrap = 'anywhere';
		if (sheet) {
			panel.style.left = `${bounds.x}px`;
			panel.style.top = `${bounds.y}px`;
			return;
		}
		const size = panel.getBoundingClientRect();
		const layout = floatingLayout(anchor, size, bounds);
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
			if (options.close) options.close();
			else {
				node.open = false;
				node.querySelector('summary')?.focus();
			}
		}
	}
	document.addEventListener('pointerdown', outside);
	document.addEventListener('focusin', outside);
	node.addEventListener('keydown', keyboard);
	return {
		update(value: ToolbarOptions) {
			options = value;
			schedule();
		},
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
