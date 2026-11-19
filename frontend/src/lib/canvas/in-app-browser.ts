export type MobileBrowser = { platform: 'android' | 'ios'; embedded: boolean };

// Heuristic only: some iOS app browsers expose exactly the same UA as Safari.
export function mobileBrowser(userAgent: string): MobileBrowser | null {
	const platform = /Android/i.test(userAgent)
		? 'android'
		: /iPhone|iPad|iPod/i.test(userAgent)
			? 'ios'
			: null;
	if (!platform) return null;
	return { platform, embedded: /Discord|FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(userAgent) };
}
