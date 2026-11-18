import { afterEach, expect, it, vi } from 'vitest';
import { dialogFocus } from './dialog-focus';

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function button(parent: HTMLElement = document.body) {
	const node = document.createElement('button');
	parent.append(node);
	vi.spyOn(node, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
	return node;
}

function confirmation(opener: HTMLElement) {
	opener.focus();
	const dialog = document.createElement('dialog');
	document.body.append(dialog);
	const action = dialogFocus(dialog);
	dialog.open = true;
	button(dialog).focus();
	return {
		dialog,
		close() {
			action.destroy();
			dialog.remove();
		}
	};
}

it('restores ordinary connected opener after dialog removal', async () => {
	const opener = button();
	confirmation(opener).close();
	await Promise.resolve();
	expect(document.activeElement).toBe(opener);
});

it('does not steal focus when a newer dialog opens before restoration', async () => {
	const opener = button();
	const current = confirmation(opener);
	current.close();
	const newer = document.createElement('dialog');
	newer.open = true;
	document.body.append(newer);
	const focus = vi.spyOn(opener, 'focus');
	await Promise.resolve();
	expect(focus).not.toHaveBeenCalled();
});

it('does not steal deliberately moved focus', async () => {
	const opener = button();
	const destination = button();
	confirmation(opener).close();
	destination.focus();
	await Promise.resolve();
	expect(document.activeElement).toBe(destination);
});

it('allows restoration into a pre-existing parent modal', async () => {
	const parent = document.createElement('dialog');
	parent.open = true;
	document.body.append(parent);
	const opener = button(parent);
	confirmation(opener).close();
	await Promise.resolve();
	expect(document.activeElement).toBe(opener);
	expect(parent.open).toBe(true);
});

it('allows native focus fallback to parent modal before restoring opener', async () => {
	const parent = document.createElement('dialog');
	parent.open = true;
	parent.tabIndex = -1;
	document.body.append(parent);
	const opener = button(parent);
	confirmation(opener).close();
	parent.focus();
	await Promise.resolve();
	expect(document.activeElement).toBe(opener);
});

it('does not mistake an unrelated pre-existing dialog for a parent modal', async () => {
	const unrelated = document.createElement('dialog');
	unrelated.open = true;
	document.body.append(unrelated);
	const opener = button();
	confirmation(opener).close();
	await Promise.resolve();
	expect(document.activeElement).not.toBe(opener);
});

it.each([
	[false, 0],
	[false, 1],
	[true, 0],
	[true, 1]
] as const)(
	'reveals focus-within controls before retrying opener (parent modal: %s, rects: %s)',
	async (nested, rects) => {
		const parent = document.createElement(nested ? 'dialog' : 'section');
		if (parent instanceof HTMLDialogElement) parent.open = true;
		document.body.append(parent);
		const surface = document.createElement('article');
		surface.tabIndex = -1;
		parent.append(surface);
		const toolbar = document.createElement('div');
		surface.append(toolbar);
		const opener = button(toolbar);
		const current = confirmation(opener);
		vi.mocked(opener.getClientRects).mockReturnValue({ length: rects } as DOMRectList);
		// Like visibility:hidden, geometry remains nonempty but focus is rejected
		// until a containing surface acquires focus and exposes its toolbar.
		const nativeFocus = opener.focus.bind(opener);
		const focus = vi.spyOn(opener, 'focus').mockImplementation(() => {
			if (surface.contains(document.activeElement)) nativeFocus();
		});
		current.close();
		await Promise.resolve();
		expect(focus).toHaveBeenCalledTimes(2);
		expect(document.activeElement).toBe(opener);
	}
);

it('keeps closed-details summary fallback', async () => {
	const details = document.createElement('details');
	details.open = true;
	const summary = document.createElement('summary');
	details.append(summary);
	document.body.append(details);
	const opener = button(details);
	const current = confirmation(opener);
	details.open = false;
	vi.mocked(opener.getClientRects).mockReturnValue({ length: 0 } as DOMRectList);
	current.close();
	await Promise.resolve();
	expect(document.activeElement).toBe(summary);
});

it('does nothing when opener disconnects before restoration', async () => {
	const opener = button();
	const current = confirmation(opener);
	current.close();
	opener.remove();
	const focus = vi.spyOn(opener, 'focus');
	await Promise.resolve();
	expect(focus).not.toHaveBeenCalled();
});

it.each([false, true])(
	'restores summary after its action disappears, unless a newer dialog opens (%s)',
	async (newerOpen) => {
		const details = document.createElement('details');
		details.open = true;
		const summary = document.createElement('summary');
		details.append(summary);
		document.body.append(details);
		const opener = button(details);
		const current = confirmation(opener);
		opener.remove();
		current.close();
		if (newerOpen) {
			const newer = document.createElement('dialog');
			newer.open = true;
			document.body.append(newer);
		}
		await Promise.resolve();
		if (newerOpen) expect(document.activeElement).not.toBe(summary);
		else expect(document.activeElement).toBe(summary);
	}
);
