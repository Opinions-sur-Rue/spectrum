import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sharedFiles } from './browser-stt-shared-assets.mjs';
import { parakeetFiles, parakeetRevision } from './parakeet-assets.mjs';

export async function verifyParakeetAssets(root) {
	const expected = {
		...sharedFiles,
		...Object.fromEntries(
			Object.entries(parakeetFiles).map(([file, hash]) => [
				`parakeet/${parakeetRevision}/${file}`,
				hash
			])
		)
	};
	const sums = [];
	let modelRaw = 0;
	let modelGzip = 0;
	let cpuRaw = 0;
	let cpuGzip = 0;
	for (const [file, hash] of Object.entries(expected)) {
		const data = await readFile(path.join(root, file));
		if (createHash('sha256').update(data).digest('hex') !== hash)
			throw new Error(`Checksum mismatch: ${file}`);
		const compressed = await readFile(path.join(root, `${file}.gz`));
		if (!gunzipSync(compressed).equals(data)) throw new Error(`Gzip mismatch: ${file}`);
		sums.push(`${hash}  ${file}`);
		sums.push(`${createHash('sha256').update(compressed).digest('hex')}  ${file}.gz`);
		if (file.startsWith('parakeet/')) {
			modelRaw += data.length;
			modelGzip += compressed.length;
		}
		if (!file.includes('asyncify')) {
			cpuRaw += data.length;
			cpuGzip += compressed.length;
		}
	}
	await readFile(path.join(root, `parakeet/${parakeetRevision}/ATTRIBUTION.txt`));
	return { sums: sums.join('\n') + '\n', modelRaw, modelGzip, cpuRaw, cpuGzip };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = process.argv.find((arg) => arg.startsWith('--root='))?.slice(7);
	if (!root) throw new Error('Use --root=/path/to/stt');
	const { sums: _sums, ...sizes } = await verifyParakeetAssets(path.resolve(root));
	console.info('Verified pinned model, VAD, runtime and gzip siblings:', sizes);
}
