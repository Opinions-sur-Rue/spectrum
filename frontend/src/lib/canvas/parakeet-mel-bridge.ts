export interface ParakeetMelFeatures {
	features: Float32Array;
	dims: number[];
	length: BigInt64Array;
	lengthDims: number[];
}

export interface ParakeetMel {
	run(audio: Float32Array): Promise<ParakeetMelFeatures>;
	release(): void;
}

/** Verified public model/runtime bytes only; audio is transferred, never fetched or stored. */
export async function openParakeetMel(
	model: Uint8Array,
	runtime: Uint8Array,
	moduleURL: string
): Promise<ParakeetMel> {
	// A nested dedicated worker is owned by its parent worker: browser termination
	// of the parent also terminates this child. Explicit release covers reload/error.
	const worker = new Worker(new URL('./parakeet-mel-worker.ts', import.meta.url), {
		type: 'module'
	});
	let closed = false;
	let ready = false;
	let nextId = 0;
	let pending:
		| {
				id: number;
				resolve(value: unknown): void;
				reject(error: Error): void;
				timer: ReturnType<typeof setTimeout>;
		  }
		| undefined;
	const fail = () => {
		if (closed) return;
		closed = true;
		worker.terminate();
		if (pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Parakeet mel worker unavailable'));
			pending = undefined;
		}
	};
	worker.onerror = fail;
	worker.onmessageerror = fail;
	worker.onmessage = ({ data }) => {
		if (!pending || data?.id !== pending.id || data.type === 'error') {
			fail();
			return;
		}
		if (data.type !== (ready ? 'features' : 'ready')) {
			fail();
			return;
		}
		const request = pending;
		pending = undefined;
		clearTimeout(request.timer);
		request.resolve(data);
	};
	const request = (message: Record<string, unknown>, transfer: Transferable[]) => {
		if (closed || pending) return Promise.reject(new Error('Parakeet mel worker busy or closed'));
		return new Promise<unknown>((resolve, reject) => {
			const id = nextId++;
			pending = { id, resolve, reject, timer: setTimeout(fail, 120000) };
			try {
				worker.postMessage({ ...message, id }, transfer);
			} catch {
				fail();
			}
		});
	};
	try {
		const modelBytes = model.slice();
		const runtimeBytes = runtime.slice();
		await request({ type: 'load', model: modelBytes, runtime: runtimeBytes, moduleURL }, [
			modelBytes.buffer,
			runtimeBytes.buffer
		]);
		ready = true;
		return {
			async run(audio) {
				if (!audio.length || audio.length > 192000) throw new Error('Audio limit');
				const copy = audio.slice();
				const result = (await request({ type: 'run', audio: copy }, [
					copy.buffer
				])) as ParakeetMelFeatures;
				if (
					!(result.features instanceof Float32Array) ||
					!(result.length instanceof BigInt64Array) ||
					!Array.isArray(result.dims) ||
					result.dims.length !== 3 ||
					result.dims[0] !== 1 ||
					result.dims[1] !== 128 ||
					!Number.isInteger(result.dims[2]) ||
					result.dims[2] < 1 ||
					result.dims[2] > 1201 ||
					result.features.length !== 128 * result.dims[2] ||
					result.lengthDims?.length !== 1 ||
					result.lengthDims[0] !== 1 ||
					result.length.length !== 1 ||
					result.length[0] < 1n ||
					result.length[0] > BigInt(result.dims[2]) ||
					!result.features.every(Number.isFinite)
				) {
					fail();
					throw new Error('Invalid Parakeet mel features');
				}
				return result;
			},
			release: fail
		};
	} catch (error) {
		fail();
		throw error;
	}
}
