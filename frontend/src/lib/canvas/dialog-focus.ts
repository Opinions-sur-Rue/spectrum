/** Restore the invoking control after a conditional native dialog is unmounted. */
export function dialogFocus(dialog: HTMLDialogElement) {
	const document = dialog.ownerDocument;
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const summary = opener?.closest('details')?.querySelector('summary');
	// A nested confirmation may sit beside, rather than inside, its parent modal.
	const parentDialogs = new Set(
		Array.from(document.querySelectorAll('dialog[open]')).filter(
			(parent) => parent !== dialog && opener && parent.contains(opener)
		)
	);
	return {
		destroy() {
			queueMicrotask(() => {
				// Do not steal focus from a newer dialog or a deliberate navigation.
				if (
					(!opener?.isConnected && !summary?.isConnected) ||
					Array.from(document.querySelectorAll('dialog[open]')).some(
						(open) => !parentDialogs.has(open)
					) ||
					(document.activeElement !== document.body && !parentDialogs.has(document.activeElement!))
				)
					return;
				const target =
					opener?.isConnected && opener.getClientRects().length
						? opener
						: summary?.isConnected
							? summary
							: opener;
				if (!target?.isConnected) return;
				const previous = document.activeElement;
				target.focus();
				if (document.activeElement !== previous) return;
				// Focus-within toolbars can hide their own invoking control. Focus a
				// containing surface first to reveal it, then retry the original target.
				for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
					if (!ancestor.matches('[tabindex], a[href], button, input, select, textarea, summary'))
						continue;
					ancestor.focus();
					if (document.activeElement === ancestor) {
						if (target.isConnected) target.focus();
						return;
					}
					if (document.activeElement !== previous) return;
				}
			});
		}
	};
}
