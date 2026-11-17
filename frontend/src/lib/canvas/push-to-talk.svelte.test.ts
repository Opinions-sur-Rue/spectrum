import { afterEach, expect, it, vi } from 'vitest';
import { pushToTalk } from './push-to-talk';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function setup() {
	const node = document.createElement('button');
	node.setPointerCapture = vi.fn();
	document.body.append(node);
	const change = vi.fn();
	const action = pushToTalk(node, { enabled: true, change });
	cleanups.push(() => action.destroy());
	return { node, change, action };
}
function pointer(node: HTMLElement, type: string, pointerId = 1) {
	node.dispatchEvent(
		Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
			pointerId,
			button: 0,
			isPrimary: true
		})
	);
}
function key(target: EventTarget, type: string, extra: KeyboardEventInit = {}) {
	target.dispatchEvent(
		new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true, ...extra })
	);
}

it('holds only until pointer release or cancellation, including leaving the button', () => {
	const { node, change } = setup();
	pointer(node, 'pointerdown');
	expect(change).toHaveBeenLastCalledWith(true);
	expect(node.setPointerCapture).toHaveBeenCalledWith(1);
	pointer(node, 'pointerup', 2);
	expect(change).toHaveBeenCalledTimes(1);
	pointer(node, 'pointerup');
	expect(change).toHaveBeenLastCalledWith(false);
	pointer(node, 'pointerdown');
	pointer(node, 'lostpointercapture');
	expect(change).toHaveBeenLastCalledWith(false);
	pointer(node, 'pointerdown');
	pointer(node, 'pointercancel');
	expect(change).toHaveBeenLastCalledWith(false);
});

it('supports hold Space without repeats, and Enter only on the hold button', () => {
	const { node, change } = setup();
	key(window, 'keydown');
	key(window, 'keydown', { repeat: true });
	expect(change.mock.calls).toEqual([[true]]);
	key(window, 'keyup');
	expect(change).toHaveBeenLastCalledWith(false);
	key(window, 'keydown', { key: 'Enter', code: 'Enter' });
	expect(change).toHaveBeenCalledTimes(2);
	key(node, 'keydown', { key: 'Enter', code: 'Enter' });
	expect(change).toHaveBeenLastCalledWith(true);
	key(node, 'keyup', { key: 'Enter', code: 'Enter' });
	expect(change).toHaveBeenLastCalledWith(false);
});

it.each(['input', 'textarea', 'select', 'button', 'summary', 'a', 'div'])(
	'does not hijack Space in %s controls/editors',
	(tag) => {
		const { change } = setup();
		const target = document.createElement(tag);
		if (tag === 'div') target.setAttribute('contenteditable', 'true');
		document.body.append(target);
		key(target, 'keydown');
		key(target, 'keyup');
		expect(change).not.toHaveBeenCalled();
	}
);

it('never starts from modified/composing keys or while another modal is open', () => {
	const { change } = setup();
	for (const extra of [
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
		{ isComposing: true }
	])
		key(window, 'keydown', extra);
	const modal = document.createElement('div');
	modal.setAttribute('aria-modal', 'true');
	document.body.append(modal);
	key(window, 'keydown');
	expect(change).not.toHaveBeenCalled();
});

it('releases on blur, pagehide, backgrounding, authority loss and destruction', () => {
	const { node, action, change } = setup();
	for (const event of ['blur', 'pagehide']) {
		pointer(node, 'pointerdown');
		window.dispatchEvent(new Event(event));
		expect(change).toHaveBeenLastCalledWith(false);
	}
	pointer(node, 'pointerdown');
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
	document.dispatchEvent(new Event('visibilitychange'));
	expect(change).toHaveBeenLastCalledWith(false);
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	pointer(node, 'pointerdown');
	action.update({ enabled: false, change });
	expect(change).toHaveBeenLastCalledWith(false);
	const count = change.mock.calls.length;
	pointer(node, 'pointerdown');
	key(window, 'keydown');
	expect(change).toHaveBeenCalledTimes(count);
	action.update({ enabled: true, change });
	pointer(node, 'pointerdown');
	action.destroy();
	expect(change).toHaveBeenLastCalledWith(false);
	key(window, 'keydown');
	expect(change).toHaveBeenCalledTimes(count + 2);
});
