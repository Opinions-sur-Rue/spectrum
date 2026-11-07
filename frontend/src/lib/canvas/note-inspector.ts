interface InspectorOptions {
	open: boolean;
	label: string;
	close: () => void;
}

/** Move the existing editor, not a copy: selection and unsaved text stay intact. */
export function noteInspector(node: HTMLElement, initial: InspectorOptions) {
	let options = initial;
	let dialog: HTMLDialogElement | null = null;
	let anchor: Comment | null = null;
	function restore() {
		if (!dialog) return;
		const previous = dialog;
		dialog = null;
		anchor?.replaceWith(node);
		anchor = null;
		previous.close();
		previous.remove();
		queueMicrotask(() => {
			if (node.isConnected && !document.querySelector('dialog[open]'))
				node.querySelector<HTMLButtonElement>('[data-note-inspect]')?.focus();
		});
	}
	function update(next: InspectorOptions) {
		options = next;
		if (!options.open) {
			restore();
			return;
		}
		if (dialog) {
			dialog.setAttribute('aria-label', options.label);
			return;
		}
		anchor = document.createComment('note-inspector');
		node.before(anchor);
		dialog = document.createElement('dialog');
		dialog.className = 'mobile-note-dialog';
		dialog.setAttribute('aria-label', options.label);
		dialog.addEventListener('cancel', (event) => {
			event.preventDefault();
			options.close();
		});
		dialog.addEventListener(
			'keydown',
			(event) => {
				// The rich-text editor can consume Escape before native dialog cancel.
				if (event.key === 'Escape' && !event.isComposing) {
					event.preventDefault();
					event.stopPropagation();
					options.close();
				}
			},
			{ capture: true }
		);
		dialog.append(node);
		document.body.append(dialog);
		dialog.showModal();
		node.querySelector<HTMLButtonElement>('[data-note-inspector-close]')?.focus();
	}
	update(initial);
	return { update, destroy: restore };
}
