export function darkenHexColor(hex: string, amountPercent: number): string {
	// Remove leading # if present
	hex = hex.replace(/^#/, '');

	// Convert hex to RGB
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);

	// Convert RGB to HSL
	const rNorm = r / 255;
	const gNorm = g / 255;
	const bNorm = b / 255;

	const max = Math.max(rNorm, gNorm, bNorm);
	const min = Math.min(rNorm, gNorm, bNorm);
	const delta = max - min;

	let h = 0;
	let s = 0;
	let l = (max + min) / 2;

	if (delta !== 0) {
		s = delta / (1 - Math.abs(2 * l - 1));

		switch (max) {
			case rNorm:
				h = ((gNorm - bNorm) / delta) % 6;
				break;
			case gNorm:
				h = (bNorm - rNorm) / delta + 2;
				break;
			case bNorm:
				h = (rNorm - gNorm) / delta + 4;
				break;
		}

		h *= 60;
		if (h < 0) h += 360;
	}

	// Decrease lightness
	l = Math.max(0, l - amountPercent / 100);

	// Convert HSL back to RGB
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r1 = 0,
		g1 = 0,
		b1 = 0;

	if (0 <= h && h < 60) {
		[r1, g1, b1] = [c, x, 0];
	} else if (60 <= h && h < 120) {
		[r1, g1, b1] = [x, c, 0];
	} else if (120 <= h && h < 180) {
		[r1, g1, b1] = [0, c, x];
	} else if (180 <= h && h < 240) {
		[r1, g1, b1] = [0, x, c];
	} else if (240 <= h && h < 300) {
		[r1, g1, b1] = [x, 0, c];
	} else {
		[r1, g1, b1] = [c, 0, x];
	}

	const rOut = Math.round((r1 + m) * 255);
	const gOut = Math.round((g1 + m) * 255);
	const bOut = Math.round((b1 + m) * 255);

	// Convert back to hex
	const toHex = (n: number) => n.toString(16).padStart(2, '0');
	return `${toHex(rOut)}${toHex(gOut)}${toHex(bOut)}`;
}
