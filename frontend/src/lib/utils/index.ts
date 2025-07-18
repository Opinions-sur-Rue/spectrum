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

/**
 * Performs the even-odd-rule Algorithm (a raycasting algorithm) to find out whether a point is in a given polygon.
 * This runs in O(n) where n is the number of edges of the polygon.
 *
 * @param {Array} polygon an array representation of the polygon where polygon[i][0] is the x Value of the i-th point and polygon[i][1] is the y Value.
 * @param {Array} point   an array representation of the point where point[0] is its x Value and point[1] is its y Value
 * @return {boolean} whether the point is in the polygon (not on the edge, just turn < into <= and > into >= for that)
 */
export const pointInPolygon = function (polygon: [number, number][], point: [number, number]) {
	//A point is in a polygon if a line from the point to infinity crosses the polygon an odd number of times
	let odd = false;
	//For each edge (In this case for each point of the polygon and the previous one)
	for (let i = 0, j = polygon.length - 1; i < polygon.length; i++) {
		//If a line from the point into infinity crosses this edge
		if (
			polygon[i][1] > point[1] !== polygon[j][1] > point[1] && // One point needs to be above, one below our y coordinate
			// ...and the edge doesn't cross our Y corrdinate before our x coordinate (but between our x coordinate and infinity)
			point[0] <
				((polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1])) /
					(polygon[j][1] - polygon[i][1]) +
					polygon[i][0]
		) {
			// Invert odd
			odd = !odd;
		}
		j = i;
	}
	//If the number of crossings was odd, the point is in the polygon
	return odd;
};

export function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

export function capitalize(str: string): string {
	if (!str) return '';
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export function stringToColorHex(input: string): string {
	// Create a simple hash from the input string
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = input.charCodeAt(i) + ((hash << 5) - hash);
		hash = hash & hash; // Convert to 32bit integer
	}

	// Extract RGB components from the hash
	const r = (hash >> 16) & 0xff;
	const g = (hash >> 8) & 0xff;
	const b = hash & 0xff;

	// Convert to 2-digit hex and concatenate
	return [r, g, b].map((val) => val.toString(16).padStart(2, '0')).join('');
}
