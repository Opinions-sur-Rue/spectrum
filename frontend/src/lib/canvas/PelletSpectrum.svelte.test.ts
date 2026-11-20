import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import PelletSpectrum from './PelletSpectrum.svelte';

const fixture = vi.hoisted(() => ({ stop: vi.fn(), observe: vi.fn() }));
vi.mock('./voice-spectrum', () => ({
	VOICE_SPECTRUM_BANDS: 32,
	observeVoiceSpectrum: fixture.observe
}));

let change: () => void;
let media: {
	matches: boolean;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
};
let update: (bands: number[]) => void;

beforeEach(() => {
	fixture.stop.mockReset();
	fixture.observe.mockReset().mockImplementation((_track, callback) => {
		update = callback;
		callback(Array(32).fill(0));
		return fixture.stop;
	});
	media = {
		matches: false,
		addEventListener: vi.fn((_event, callback) => {
			change = callback;
		}),
		removeEventListener: vi.fn()
	};
	vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it('shows three crossing sine waves as soon as the mic is open, even when silent', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack, scale: 1 });
	await tick();
	const svg = view.getByTestId('pellet-voice-spectrum');
	expect(svg).toHaveAttribute('data-bands', '32');
	expect(svg).toHaveAttribute('data-energy', '0');
	expect(view.container.querySelectorAll('[data-wave]')).toHaveLength(3);
	expect(fixture.observe).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.any(Function));
	view.unmount();
	expect(fixture.stop).toHaveBeenCalledOnce();
});

it('replaces the observer when the microphone changes but not for zoom changes', async () => {
	const track = new EventTarget() as MediaStreamTrack;
	const view = render(PelletSpectrum, { track, scale: 1 });
	await tick();
	await view.rerender({ scale: 0.25 });
	expect(fixture.observe).toHaveBeenCalledOnce();
	await view.rerender({ track: new EventTarget() as MediaStreamTrack });
	expect(fixture.stop).toHaveBeenCalledOnce();
	expect(fixture.observe).toHaveBeenCalledTimes(2);
});

it('updates the centroid as the frequency content shifts', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack, scale: 1 });
	await tick();
	expect(view.getByTestId('pellet-voice-spectrum')).toHaveAttribute('data-centroid', '0');
	const bass = Array(32).fill(0);
	bass[4] = 1;
	update(bass);
	await tick();
	expect(Number(view.getByTestId('pellet-voice-spectrum').getAttribute('data-centroid'))).toBe(4);
	const treble = Array(32).fill(0);
	treble[28] = 1;
	update(treble);
	await tick();
	expect(Number(view.getByTestId('pellet-voice-spectrum').getAttribute('data-centroid'))).toBe(28);
});

it('stops analysis for reduced motion and does not render the spectrum', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack, scale: 1 });
	await tick();
	media.matches = true;
	change();
	await tick();
	expect(view.queryByTestId('pellet-voice-spectrum')).toBeNull();
	expect(fixture.stop).toHaveBeenCalledOnce();
});
