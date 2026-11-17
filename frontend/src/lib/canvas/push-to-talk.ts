interface Options {
	enabled: boolean;
	change: (pressed: boolean) => void;
}

/** Hold-only input. Never captures keys while typing or inside another control. */
export function pushToTalk(node: HTMLButtonElement, options: Options) {
	let pointer: number | null = null;
	let key: string | null = null;
	let pressed = false;
	function updatePressed() {
		const next = options.enabled && (pointer !== null || key !== null);
		if (next !== pressed) {
			pressed = next;
			options.change(next);
		}
	}
	function release() {
		pointer = null;
		key = null;
		updatePressed();
	}
	function down(event: PointerEvent) {
		if (
			!options.enabled ||
			document.visibilityState === 'hidden' ||
			!event.isPrimary ||
			event.button !== 0 ||
			pointer !== null
		)
			return;
		event.preventDefault();
		node.focus({ preventScroll: true });
		pointer = event.pointerId;
		try {
			node.setPointerCapture(event.pointerId);
		} catch {
			pointer = null;
			return;
		}
		updatePressed();
	}
	function up(event: PointerEvent) {
		if (pointer !== event.pointerId) return;
		pointer = null;
		updatePressed();
	}
	function keyDown(event: KeyboardEvent) {
		if (
			!options.enabled ||
			document.visibilityState === 'hidden' ||
			event.repeat ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		)
			return;
		const space = event.code === 'Space' || event.key === ' ';
		if (!space && !(event.key === 'Enter' && event.target === node)) return;
		if (event.target !== node) {
			const target = event.target instanceof Element ? event.target : null;
			if (
				document.querySelector('dialog[open], [aria-modal="true"]') ||
				target?.closest(
					'input, textarea, select, button, summary, a, [contenteditable], [role="textbox"], [role="button"], [role="slider"]'
				)
			)
				return;
		}
		event.preventDefault();
		key = space ? 'Space' : 'Enter';
		updatePressed();
	}
	function keyUp(event: KeyboardEvent) {
		if (
			(key === 'Space' && (event.code === 'Space' || event.key === ' ')) ||
			(key === 'Enter' && event.key === 'Enter')
		) {
			event.preventDefault();
			key = null;
			updatePressed();
		}
	}
	function visibility() {
		if (document.visibilityState === 'hidden') release();
	}
	function focusChange(event: FocusEvent) {
		if (event.target !== node) release();
	}
	function contextMenu(event: Event) {
		event.preventDefault();
		release();
	}
	node.addEventListener('pointerdown', down);
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
		node.addEventListener(type, up as EventListener);
	node.addEventListener('contextmenu', contextMenu);
	window.addEventListener('keydown', keyDown);
	window.addEventListener('keyup', keyUp);
	window.addEventListener('blur', release);
	window.addEventListener('pagehide', release);
	document.addEventListener('visibilitychange', visibility);
	document.addEventListener('focusin', focusChange);
	return {
		update(next: Options) {
			options = next;
			if (!options.enabled) release();
		},
		destroy() {
			release();
			node.removeEventListener('pointerdown', down);
			for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
				node.removeEventListener(type, up as EventListener);
			node.removeEventListener('contextmenu', contextMenu);
			window.removeEventListener('keydown', keyDown);
			window.removeEventListener('keyup', keyUp);
			window.removeEventListener('blur', release);
			window.removeEventListener('pagehide', release);
			document.removeEventListener('visibilitychange', visibility);
			document.removeEventListener('focusin', focusChange);
		}
	};
}
