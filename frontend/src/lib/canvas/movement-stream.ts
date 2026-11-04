import type { Point } from './camera';

/** Leading + trailing updates at 20Hz; release always flushes the exact last point. */
export function createMovementStream(send: (point: Point) => void, interval = 50) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: Point | null = null;
	let lastSentAt = -Infinity;
	function emit(point: Point) {
		lastSentAt = Date.now();
		send({ ...point });
	}
	function cancel() {
		clearTimeout(timer);
		timer = undefined;
		pending = null;
		lastSentAt = -Infinity;
	}
	return {
		update(point: Point) {
			pending = { ...point };
			const delay = interval - (Date.now() - lastSentAt);
			if (delay <= 0) {
				clearTimeout(timer);
				timer = undefined;
				emit(pending);
				pending = null;
			} else if (!timer)
				timer = setTimeout(() => {
					timer = undefined;
					if (pending) {
						const next = pending;
						pending = null;
						emit(next);
					}
				}, delay);
		},
		finish(point: Point) {
			cancel();
			emit(point);
		},
		cancel
	};
}
