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

	let r1: number, g1: number, b1: number;

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

/**
 * Checks if a circle intersects any edge of a polygon.
 * Used for pellet (paddle) collision detection where the circle radius matters.
 *
 * @param polygon array of [x, y] points defining the polygon edges
 * @param cx center x of the circle
 * @param cy center y of the circle
 * @param radius radius of the circle
 * @return boolean true if the circle intersects or is inside the polygon
 */
export const circleIntersectsPolygon = function (
	polygon: [number, number][],
	cx: number,
	cy: number,
	radius: number
): boolean {
	// First check if center is inside polygon
	if (pointInPolygon(polygon, [cx, cy])) {
		return true;
	}

	// Check distance from circle center to each polygon edge
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const x1 = polygon[i][0];
		const y1 = polygon[i][1];
		const x2 = polygon[j][0];
		const y2 = polygon[j][1];

		// Find closest point on line segment to circle center
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;

		let t = 0;
		if (len2 > 0) {
			t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
		}

		const closestX = x1 + t * dx;
		const closestY = y1 + t * dy;

		const distSq = (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY);
		if (distSq <= radius * radius) {
			return true;
		}
	}

	return false;
};

export function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

/**
 * Convert a Fabric path (array of absolute commands: M, L, H, V, C, S, Q, T, A, Z)
 * into a polygon by sampling curves into N segments per command.
 */
export function pathToPolygon(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	path: any[],
	samples = 16
): [number, number][] {
	const points: [number, number][] = [];
	let curX = 0;
	let curY = 0;
	let startX = 0;
	let startY = 0;

	const push = (x: number, y: number) => {
		points.push([x, y]);
		curX = x;
		curY = y;
	};

	for (const cmd of path) {
		const type = cmd[0];
		switch (type) {
			case 'M': {
				startX = cmd[1];
				startY = cmd[2];
				push(cmd[1], cmd[2]);
				break;
			}
			case 'L': {
				push(cmd[1], cmd[2]);
				break;
			}
			case 'H': {
				push(cmd[1], curY);
				break;
			}
			case 'V': {
				push(curX, cmd[1]);
				break;
			}
			case 'C': {
				const x1 = cmd[1],
					y1 = cmd[2];
				const x2 = cmd[3],
					y2 = cmd[4];
				const x = cmd[5],
					y = cmd[6];
				const p0x = curX,
					p0y = curY;
				for (let i = 1; i <= samples; i++) {
					const t = i / samples;
					const mt = 1 - t;
					const bx =
						mt * mt * mt * p0x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x;
					const by =
						mt * mt * mt * p0y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y;
					points.push([bx, by]);
				}
				curX = x;
				curY = y;
				break;
			}
			case 'Q': {
				const x1 = cmd[1],
					y1 = cmd[2];
				const x = cmd[3],
					y = cmd[4];
				const p0x = curX,
					p0y = curY;
				for (let i = 1; i <= samples; i++) {
					const t = i / samples;
					const mt = 1 - t;
					const bx = mt * mt * p0x + 2 * mt * t * x1 + t * t * x;
					const by = mt * mt * p0y + 2 * mt * t * y1 + t * t * y;
					points.push([bx, by]);
				}
				curX = x;
				curY = y;
				break;
			}
			case 'A': {
				const rx0 = Math.abs(cmd[1]);
				const ry0 = Math.abs(cmd[2]);
				const xRotDeg = cmd[3];
				const largeArc = !!cmd[4];
				const sweep = !!cmd[5];
				const x2 = cmd[6],
					y2 = cmd[7];
				const x1 = curX,
					y1 = curY;
				if (rx0 === 0 || ry0 === 0 || (x1 === x2 && y1 === y2)) {
					push(x2, y2);
					break;
				}
				const phi = (xRotDeg * Math.PI) / 180;
				const cosPhi = Math.cos(phi),
					sinPhi = Math.sin(phi);
				const dx = (x1 - x2) / 2,
					dy = (y1 - y2) / 2;
				const x1p = cosPhi * dx + sinPhi * dy;
				const y1p = -sinPhi * dx + cosPhi * dy;
				let rx = rx0,
					ry = ry0;
				const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
				if (lambda > 1) {
					const s = Math.sqrt(lambda);
					rx *= s;
					ry *= s;
				}
				const sign = largeArc === sweep ? -1 : 1;
				const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
				const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
				const factor = sign * Math.sqrt(Math.max(0, num / den));
				const cxp = (factor * (rx * y1p)) / ry;
				const cyp = (factor * -(ry * x1p)) / rx;
				const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
				const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
				const angle = (ux: number, uy: number, vx: number, vy: number) => {
					const dot = ux * vx + uy * vy;
					const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
					let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
					if (ux * vy - uy * vx < 0) a = -a;
					return a;
				};
				const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
				let dTheta = angle(
					(x1p - cxp) / rx,
					(y1p - cyp) / ry,
					(-x1p - cxp) / rx,
					(-y1p - cyp) / ry
				);
				if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
				else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
				for (let i = 1; i <= samples; i++) {
					const t = i / samples;
					const a = theta1 + dTheta * t;
					const px = cosPhi * (rx * Math.cos(a)) - sinPhi * (ry * Math.sin(a)) + cx;
					const py = sinPhi * (rx * Math.cos(a)) + cosPhi * (ry * Math.sin(a)) + cy;
					points.push([px, py]);
				}
				curX = x2;
				curY = y2;
				break;
			}
			case 'Z':
			case 'z': {
				curX = startX;
				curY = startY;
				break;
			}
		}
	}
	return points;
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
