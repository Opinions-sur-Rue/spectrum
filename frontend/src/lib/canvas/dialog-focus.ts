/** Restore the invoking control after a conditional native dialog is unmounted. */
export function dialogFocus(dialog: HTMLDialogElement) {
	const document = dialog.ownerDocument;
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const summary = opener?.closest('details')?.querySelector('summary');
	return {
		destroy() {
			queueMicrotask(() => {
				// Do not steal focus from a newer dialog or a deliberate navigation.
				if (document.querySelector('dialog[open]') || document.activeElement !== document.body)
					return;
				const target = opener?.getClientRects().length ? opener : summary;
				if (target?.isConnected) target.focus();
			});
		}
	};
}
