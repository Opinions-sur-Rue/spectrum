export const VOICE_SPECTRUM_BANDS = 32;

/** Log-spaced voice-frequency energy, computed only in the current browser. */
export function voiceBands(bins: Uint8Array, sampleRate: number, fftSize: number): number[] {
	if (
		!bins.length ||
		!Number.isFinite(sampleRate) ||
		sampleRate <= 0 ||
		!Number.isFinite(fftSize) ||
		fftSize <= 0
	)
		return Array(VOICE_SPECTRUM_BANDS).fill(0);
	const high = Math.min(8000, sampleRate / 2);
	const low = Math.min(80, high / 2);
	return Array.from({ length: VOICE_SPECTRUM_BANDS }, (_, band) => {
		const startHz = low * (high / low) ** (band / VOICE_SPECTRUM_BANDS);
		const endHz = low * (high / low) ** ((band + 1) / VOICE_SPECTRUM_BANDS);
		const start = Math.min(bins.length - 1, Math.floor((startHz * fftSize) / sampleRate));
		const end = Math.min(
			bins.length,
			Math.max(start + 1, Math.ceil((endHz * fftSize) / sampleRate))
		);
		let power = 0;
		for (let i = start; i < end; i++) power += (bins[i] / 255) ** 2;
		const energy = Math.sqrt(power / (end - start));
		return energy < 0.035 ? 0 : Math.min(1, Math.sqrt(energy) * 1.15);
	});
}

/** Analyse an already-published track. Never capture, play, persist or send audio. */
export function observeVoiceSpectrum(
	track: MediaStreamTrack,
	update: (bands: number[]) => void
): () => void {
	if (track.readyState !== 'live') return () => {};
	let context: AudioContext | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	let analyser: AnalyserNode | undefined;
	let frame = 0;
	let stopped = false;
	let last = -Infinity;
	let smoothed = Array(VOICE_SPECTRUM_BANDS).fill(0) as number[];
	function stop() {
		if (stopped) return;
		stopped = true;
		cancelAnimationFrame(frame);
		track.removeEventListener('ended', stop);
		track.removeEventListener('mute', mute);
		document.removeEventListener('visibilitychange', visibility);
		source?.disconnect();
		analyser?.disconnect();
		if (context) void context.close().catch(() => {});
		update([]);
	}
	function mute() {
		smoothed = Array(VOICE_SPECTRUM_BANDS).fill(0);
		update(smoothed);
	}
	function visibility() {
		cancelAnimationFrame(frame);
		mute();
		if (!document.hidden && !stopped) frame = requestAnimationFrame(tick);
	}
	let bins: Uint8Array<ArrayBuffer>;
	function tick(now: number) {
		if (stopped || document.hidden) return;
		if (track.readyState !== 'live') {
			stop();
			return;
		}
		if (now - last >= 40 && analyser && context) {
			last = now;
			if (context.state === 'running' && !track.muted && track.enabled) {
				try {
					analyser.getByteFrequencyData(bins);
				} catch {
					stop();
					return;
				}
				const next = voiceBands(bins, context.sampleRate, analyser.fftSize);
				smoothed = next.map(
					(value, i) => smoothed[i] + (value - smoothed[i]) * (value > smoothed[i] ? 0.65 : 0.2)
				);
				update(smoothed);
			} else update([]);
		}
		frame = requestAnimationFrame(tick);
	}
	try {
		context = new AudioContext();
		source = context.createMediaStreamSource(new MediaStream([track]));
		analyser = context.createAnalyser();
		analyser.fftSize = 1024;
		analyser.minDecibels = -85;
		analyser.maxDecibels = -20;
		analyser.smoothingTimeConstant = 0.65;
		bins = new Uint8Array(analyser.frequencyBinCount);
		source.connect(analyser); // Deliberately no connection to context.destination.
		track.addEventListener('ended', stop);
		track.addEventListener('mute', mute);
		document.addEventListener('visibilitychange', visibility);
		void context.resume().catch(stop);
		if (!document.hidden) frame = requestAnimationFrame(tick);
	} catch {
		stop();
	}
	return stop;
}
