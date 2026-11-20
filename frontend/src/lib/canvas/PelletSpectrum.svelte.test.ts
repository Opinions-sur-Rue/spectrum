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
beforeEach(() => {
	fixture.stop.mockReset();
	fixture.observe.mockReset().mockImplementation((_track, callback) => {
		callback(Array(32).fill(0.5));
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

it('renders real supplied bands and does not recreate analysis for speaking or zoom changes', async () => {
	const track = new EventTarget() as MediaStreamTrack;
	const view = render(PelletSpectrum, { track, active: true, scale: 1 });
	await tick();
	expect(view.getByTestId('pellet-voice-spectrum').querySelectorAll('.bar')).toHaveLength(32);
	await view.rerender({ active: false, scale: 0.25 });
	expect(view.queryByTestId('pellet-voice-spectrum')).toBeNull();
	expect(fixture.observe).toHaveBeenCalledExactlyOnceWith(track, expect.any(Function));
	await view.rerender({ active: true });
	expect(view.getByTestId('pellet-voice-spectrum')).toHaveAttribute('aria-hidden', 'true');
	expect(fixture.observe).toHaveBeenCalledOnce();
	view.unmount();
	expect(fixture.stop).toHaveBeenCalledOnce();
});

it('stops analysis for reduced motion and replaces the observer when the mic changes', async () => {
	const view = render(PelletSpectrum, {
		track: new EventTarget() as MediaStreamTrack,
		active: true,
		scale: 1
	});
	await tick();
	await view.rerender({ track: new EventTarget() as MediaStreamTrack });
	expect(fixture.stop).toHaveBeenCalledOnce();
	media.matches = true;
	change();
	await tick();
	expect(view.queryByTestId('pellet-voice-spectrum')).toBeNull();
	expect(fixture.stop).toHaveBeenCalledTimes(2);
});
