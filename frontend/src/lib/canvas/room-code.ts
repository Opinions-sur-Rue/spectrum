/** Extract an invitation without navigating to or fetching its URL. */
export function parseRoomCode(input: string): string | null {
	let candidate = input.trim();
	if (!candidate) return null;
	if (!/^(?:OSR-)?[a-z0-9]{4,64}$/i.test(candidate)) {
		try {
			const url = new URL(candidate, 'https://spectrum.invalid');
			if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
			const fromQuery = url.searchParams.get('room');
			const fromPath = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
			if (fromQuery === null && !/^OSR-[a-z0-9]{4,64}$/i.test(fromPath)) return null;
			candidate = fromQuery ?? fromPath;
		} catch {
			return null;
		}
	}
	candidate = candidate.trim().toUpperCase();
	const code = candidate.startsWith('OSR-') ? candidate.slice(4) : candidate;
	return /^[A-Z0-9]{4,64}$/.test(code) ? `OSR-${code}` : null;
}
