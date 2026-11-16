/** Keep a full-screen mobile panel modal to keyboard and assistive technology. */
export function panelModality(node: HTMLElement, active: boolean) {
	const previous = new Map<HTMLElement, boolean>();
	function restore() {
		for (const [element, inert] of previous) element.inert = inert;
		previous.clear();
	}
	function update(enabled: boolean) {
		restore();
		if (!enabled) return;
		let current: HTMLElement | null = node;
		while (current && current !== document.body) {
			for (const sibling of current.parentElement?.children ?? []) {
				// Native confirmation dialogs must be able to open above this panel.
				if (
					sibling === current ||
					!(sibling instanceof HTMLElement) ||
					sibling instanceof HTMLDialogElement
				)
					continue;
				previous.set(sibling, sibling.inert);
				sibling.inert = true;
			}
			current = current.parentElement;
		}
	}
	update(active);
	return { update, destroy: restore };
}

export function trapPanelFocus(node: HTMLElement, event: KeyboardEvent) {
	if (event.key !== 'Tab') return;
	const controls = [
		...node.querySelectorAll<HTMLElement>(
			'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'
		)
	].filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
	const first = controls[0],
		last = controls.at(-1);
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last?.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first?.focus();
	}
}
