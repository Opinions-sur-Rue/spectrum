import { afterEach, expect, it, vi } from 'vitest';
import { roomViewport } from './room-viewport';

afterEach(() => {
	vi.unstubAllGlobals();
	document.documentElement.classList.remove('v2-active');
});

it('tracks visible keyboard bounds and removes the v2-only page scope on destroy', () => {
	const viewport = Object.assign(new EventTarget(), {
		width: 390,
		height: 844,
		offsetLeft: 0,
		offsetTop: 0
	});
	vi.stubGlobal('visualViewport', viewport);
	let frame: FrameRequestCallback = () => {};
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frame = callback;
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', vi.fn());
	const node = document.createElement('div');
	const action = roomViewport(node);
	expect(document.documentElement.classList.contains('v2-active')).toBe(true);
	expect(node.style.getPropertyValue('--v2-visible-height')).toBe('844px');
	Object.assign(viewport, { height: 320, offsetLeft: 12, offsetTop: 80 });
	viewport.dispatchEvent(new Event('resize'));
	frame(0);
	expect(node.style.getPropertyValue('--v2-visible-height')).toBe('320px');
	expect(node.style.getPropertyValue('--v2-visible-x')).toBe('12px');
	expect(node.style.getPropertyValue('--v2-visible-y')).toBe('80px');
	action.destroy();
	expect(document.documentElement.classList.contains('v2-active')).toBe(false);
});
