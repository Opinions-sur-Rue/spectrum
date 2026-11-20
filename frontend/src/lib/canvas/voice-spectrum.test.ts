import { afterEach, expect, it, vi } from 'vitest';
import { observeVoiceSpectrum, voiceBands, VOICE_SPECTRUM_BANDS } from './voice-spectrum';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it('maps real frequency bins into bounded log-spaced bands', () => {
	expect(voiceBands(new Uint8Array(512), 48000, 1024)).toEqual(Array(32).fill(0));
	const bins = new Uint8Array(512);
	bins[Math.round((1000 * 1024) / 48000)] = 255;
	const bands = voiceBands(bins, 48000, 1024);
	expect(bands).toHaveLength(VOICE_SPECTRUM_BANDS);
	expect(bands.some((value) => value > 0)).toBe(true);
	expect(bands.filter((value) => value > 0).length).toBeLessThan(5);
	expect(bands.every((value) => value >= 0 && value <= 1)).toBe(true);
	expect(voiceBands(bins, NaN, 1024)).toEqual(Array(32).fill(0));
});

function fixture() {
	const frames = new Map<number, FrameRequestCallback>();
	let id = 0;
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.set(++id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
	const document = Object.assign(new EventTarget(), { hidden: false });
	vi.stubGlobal('document', document);
	const track = Object.assign(new EventTarget(), {
		readyState: 'live',
		enabled: true,
		muted: false,
		stop: vi.fn()
	});
	vi.stubGlobal(
		'MediaStream',
		class {
			constructor(readonly tracks: unknown[]) {}
		}
	);
	const source = { connect: vi.fn(), disconnect: vi.fn() };
	const analyser = {
		fftSize: 0,
		frequencyBinCount: 512,
		minDecibels: 0,
		maxDecibels: 0,
		smoothingTimeConstant: 0,
		getByteFrequencyData: vi.fn((bins: Uint8Array) => {
			bins.fill(0);
			bins[10] = 255;
		}),
		disconnect: vi.fn()
	};
	const context = {
		state: 'running',
		sampleRate: 48000,
		destination: {},
		resume: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		createMediaStreamSource: vi.fn(() => source),
		createAnalyser: vi.fn(() => analyser)
	};
	vi.stubGlobal(
		'AudioContext',
		vi.fn(function () {
			return context;
		})
	);
	function frame(time: number) {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(time);
	}
	return { frames, frame, document, track, source, analyser, context };
}

it('analyses the existing track at most 25fps without playback or stopping capture', () => {
	const f = fixture();
	const update = vi.fn();
	const stop = observeVoiceSpectrum(f.track as unknown as MediaStreamTrack, update);
	f.frame(0);
	f.frame(20);
	f.frame(40);
	expect(f.analyser.getByteFrequencyData).toHaveBeenCalledTimes(2);
	expect(update.mock.calls[0][0]).toHaveLength(32);
	expect(f.source.connect).toHaveBeenCalledExactlyOnceWith(f.analyser);
	stop();
	stop();
	expect(f.context.close).toHaveBeenCalledOnce();
	expect(f.source.disconnect).toHaveBeenCalledOnce();
	expect(f.track.stop).not.toHaveBeenCalled();
	expect(f.frames.size).toBe(0);
	expect(update).toHaveBeenLastCalledWith([]);
});

it('pauses hidden-tab work, clears mute levels, resumes and releases on track end', () => {
	const f = fixture();
	const update = vi.fn();
	observeVoiceSpectrum(f.track as unknown as MediaStreamTrack, update);
	f.frame(0);
	f.track.dispatchEvent(new Event('mute'));
	expect(update).toHaveBeenLastCalledWith(Array(32).fill(0));
	f.document.hidden = true;
	f.document.dispatchEvent(new Event('visibilitychange'));
	expect(f.frames.size).toBe(0);
	f.document.hidden = false;
	f.document.dispatchEvent(new Event('visibilitychange'));
	expect(f.frames.size).toBe(1);
	f.track.readyState = 'ended';
	f.track.dispatchEvent(new Event('ended'));
	expect(f.context.close).toHaveBeenCalledOnce();
	expect(f.track.stop).not.toHaveBeenCalled();
	expect(f.frames.size).toBe(0);
});

it('cleans up a rejected audio context resume without affecting voice', async () => {
	const f = fixture();
	f.context.resume.mockRejectedValue(new Error('blocked'));
	const update = vi.fn();
	observeVoiceSpectrum(f.track as unknown as MediaStreamTrack, update);
	await Promise.resolve();
	expect(f.context.close).toHaveBeenCalledOnce();
	expect(f.frames.size).toBe(0);
	expect(f.track.stop).not.toHaveBeenCalled();
});

it('falls back safely if FFT reading fails at runtime', () => {
	const f = fixture();
	f.analyser.getByteFrequencyData.mockImplementation(() => {
		throw new Error('unavailable');
	});
	const update = vi.fn();
	observeVoiceSpectrum(f.track as unknown as MediaStreamTrack, update);
	f.frame(0);
	expect(update).toHaveBeenLastCalledWith([]);
	expect(f.context.close).toHaveBeenCalledOnce();
	expect(f.frames.size).toBe(0);
	expect(f.track.stop).not.toHaveBeenCalled();
});
