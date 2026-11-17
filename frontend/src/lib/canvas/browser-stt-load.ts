export type STTAssetId =
	| 'runtime'
	| 'vad'
	| 'vocabulary'
	| 'features'
	| 'encoder'
	| 'decoder'
	| 'model';
export interface STTLoadProgress {
	phase: 'download' | 'initializing' | 'cache';
	loaded: number;
	total: number;
	asset: STTAssetId;
	fileOnly?: boolean;
	cached?: boolean;
	cacheAvailable?: boolean;
}
export class STTLoadError extends Error {
	constructor(public reason: 'download' | 'assets' | 'engine') {
		super(reason);
	}
}
export interface STTPublicAsset {
	id: STTAssetId;
	url: string;
	bytes: number;
	sha256: string;
}

/** Public, fingerprint-keyed model data only. Never accepts audio or room data. */
export class STTAssetLoader {
	private completed = new Set<STTAssetId>();
	private cache: Promise<Cache | undefined>;
	private total: number;
	private cacheAvailable: boolean | undefined;
	constructor(
		private assets: STTPublicAsset[],
		private progress: (value: STTLoadProgress) => void
	) {
		this.total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
		this.cache =
			typeof caches === 'undefined'
				? Promise.resolve(undefined)
				: caches.open('spectrum-stt-public-v1').catch(() => undefined);
	}
	private report(
		phase: STTLoadProgress['phase'],
		asset: STTPublicAsset,
		loaded = 0,
		cached = false
	) {
		const previous = this.assets.reduce(
			(sum, item) => sum + (item.id !== asset.id && this.completed.has(item.id) ? item.bytes : 0),
			0
		);
		this.progress({
			phase,
			asset: asset.id,
			loaded: previous + loaded,
			total: this.total,
			cached,
			cacheAvailable: this.cacheAvailable
		});
	}
	initializing(id: STTAssetId) {
		const asset = this.assets.find((item) => item.id === id);
		if (asset) this.report('initializing', asset, this.completed.has(id) ? asset.bytes : 0);
	}
	private async valid(data: Uint8Array, asset: STTPublicAsset) {
		if (data.length !== asset.bytes) return false;
		const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
		return (
			Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') ===
			asset.sha256
		);
	}
	async read(id: STTAssetId): Promise<Uint8Array> {
		const asset = this.assets.find((item) => item.id === id);
		if (!asset) throw new STTLoadError('assets');
		const url = new URL(asset.url, location.origin);
		if (url.origin !== location.origin || !url.pathname.startsWith('/stt/'))
			throw new STTLoadError('assets');
		// Query keys also prevent stale native HTTP caches after an ORT upgrade.
		url.searchParams.set('sha256', asset.sha256);
		this.report('download', asset);
		const cache = await this.cache;
		this.cacheAvailable ??= !!cache;
		let stored: Response | undefined;
		try {
			stored = await cache?.match(url.href);
		} catch {
			this.cacheAvailable = false;
			/* Private mode/quota. */
		}
		if (stored) {
			this.report('cache', asset);
			const data = new Uint8Array(await stored.arrayBuffer());
			if (await this.valid(data, asset)) {
				this.completed.add(id);
				this.report('download', asset, data.length, true);
				return data;
			}
			await cache?.delete(url.href).catch(() => false);
		}
		let response: Response;
		try {
			response = await fetch(url.href, { redirect: 'error' });
		} catch {
			throw new STTLoadError('download');
		}
		if (!response.ok || response.headers.get('content-type')?.includes('text/html'))
			throw new STTLoadError('assets');
		const data = new Uint8Array(asset.bytes);
		const reader = response.body?.getReader();
		if (!reader) throw new STTLoadError('download');
		let loaded = 0;
		let reportedAt = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (loaded + value.length > data.length) throw new STTLoadError('assets');
				data.set(value, loaded);
				loaded += value.length;
				if (performance.now() - reportedAt >= 200 || loaded === data.length) {
					this.report('download', asset, loaded);
					reportedAt = performance.now();
				}
			}
		} catch (error) {
			await reader.cancel().catch(() => {});
			throw error instanceof STTLoadError ? error : new STTLoadError('download');
		} finally {
			reader.releaseLock();
		}
		if (loaded !== asset.bytes || !(await this.valid(data, asset)))
			throw new STTLoadError('assets');
		if (cache) {
			this.report('cache', asset, loaded);
			try {
				await cache.put(
					url.href,
					new Response(data.buffer, { headers: { 'Content-Type': 'application/octet-stream' } })
				);
				// Some storage implementations resolve put() but silently discard the entry.
				// Opening a cache alone therefore does not establish that caching works.
				if (!(await cache.match(url.href))) this.cacheAvailable = false;
			} catch {
				this.cacheAvailable = false;
				/* Recognition can continue without durable model caching. */
			}
		}
		this.completed.add(id);
		this.report('download', asset, loaded);
		return data;
	}
}
