import { visibleViewport } from './floating-layout';

/** Scope page scroll/safe-area handling to v2; leave the v1 document unchanged. */
export function roomViewport(node: HTMLElement) {
	const root = document.documentElement;
	const previous = root.classList.contains('v2-active');
	root.classList.add('v2-active');
	let frame = 0;
	function position() {
		frame = 0;
		const bounds = visibleViewport();
		for (const [key, value] of Object.entries(bounds))
			node.style.setProperty(`--v2-visible-${key}`, `${value}px`);
	}
	function schedule() {
		if (!frame) frame = requestAnimationFrame(position);
	}
	position();
	window.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	return {
		destroy() {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('scroll', schedule);
			if (!previous) root.classList.remove('v2-active');
		}
	};
}
