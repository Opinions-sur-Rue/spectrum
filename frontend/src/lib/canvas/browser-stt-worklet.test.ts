import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it.each([16000, 44100, 48000, 96000])(
	'resamples %i Hz into exact bounded 16 kHz frames',
	(rate) => {
		const outputs: Float32Array[] = [];
		let Processor: new () => { process: (inputs: Float32Array[][]) => boolean };
		vm.runInNewContext(
			readFileSync(new URL('../../../static/stt-capture.js', import.meta.url), 'utf8'),
			{
				sampleRate: rate,
				AudioWorkletProcessor: class {
					port = { postMessage: (frame: Float32Array) => outputs.push(frame) };
				},
				registerProcessor: (_name: string, value: typeof Processor) => {
					Processor = value;
				}
			}
		);
		const processor = new Processor!();
		for (let remaining = rate; remaining > 0; remaining -= 128)
			processor.process([[new Float32Array(Math.min(128, remaining)).fill(0.25)]]);
		expect(outputs).toHaveLength(50);
		expect(
			outputs.every(
				(frame) =>
					frame.length === 320 && [...frame].every((sample) => Math.abs(sample - 0.25) < 1e-6)
			)
		).toBe(true);
	}
);
