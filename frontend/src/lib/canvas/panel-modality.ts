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
				if (sibling === current || !(sibling instanceof HTMLElement)) continue;
				previous.set(sibling, sibling.inert);
				sibling.inert = true;
			}
			current = current.parentElement;
		}
	}
	update(active);
	return { update, destroy: restore };
}
