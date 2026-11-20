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

it('shows three filled frequency sectors as soon as the mic is open, even when silent', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
	await tick();
	const svg = view.getByTestId('pellet-voice-spectrum');
	expect(svg).toHaveAttribute('data-bands', '32');
	expect(svg).toHaveAttribute('data-resolution', '12');
	expect(svg).toHaveAttribute('data-energy', '0');
	expect(view.container.querySelectorAll('[data-wave]')).toHaveLength(3);
	expect(fixture.observe).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.any(Function));
	view.unmount();
	expect(fixture.stop).toHaveBeenCalledOnce();
});

it('uses independent gradient ids when several participants have a spectrum', async () => {
	const first = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
	const second = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
	await tick();
	const ids = [...document.querySelectorAll('radialGradient')].map((node) => node.id);
	expect(new Set(ids).size).toBe(6);
	for (const view of [first, second]) {
		for (const node of view.container.querySelectorAll('[data-wave]')) {
			const id = node.getAttribute('fill')!.slice(5, -1);
			expect(view.container.querySelector(`[id="${id}"]`)).not.toBeNull();
		}
	}
});

it('derives spectrum colours from the participant pellet and updates without restarting analysis', async () => {
	const view = render(PelletSpectrum, {
		track: new EventTarget() as MediaStreamTrack,
		color: 'cc4422'
	});
	await tick();
	const svg = view.getByTestId('pellet-voice-spectrum');
	expect(svg.style.getPropertyValue('--spectrum-color')).toBe('#cc4422');
	await view.rerender({ color: '2277aa' });
	expect(svg.style.getPropertyValue('--spectrum-color')).toBe('#2277aa');
	expect(fixture.observe).toHaveBeenCalledOnce();
	await view.rerender({ color: 'invalid' });
	expect(svg.style.getPropertyValue('--spectrum-color')).toBe('var(--color-primary)');
});

it('keeps geometry in board units and replaces the observer only when the track changes', async () => {
	const track = new EventTarget() as MediaStreamTrack;
	const view = render(PelletSpectrum, { track });
	await tick();
	const svg = view.getByTestId('pellet-voice-spectrum');
	expect(svg.style.width).toBe('64.95px');
	expect(svg.style.height).toBe('64.95px');
	expect(fixture.observe).toHaveBeenCalledOnce();
	await view.rerender({ track: new EventTarget() as MediaStreamTrack });
	expect(fixture.stop).toHaveBeenCalledOnce();
	expect(fixture.observe).toHaveBeenCalledTimes(2);
});

it('updates the centroid as the frequency content shifts', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
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

it('preserves different peak positions within one frequency group', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
	await tick();
	const path = () => view.container.querySelector('[data-wave="low"]')?.getAttribute('d');
	const first = Array(32).fill(0);
	first[2] = 1;
	update(first);
	await tick();
	const firstPath = path();
	const second = Array(32).fill(0);
	second[6] = 1;
	update(second);
	await tick();
	expect(path()).not.toBe(firstPath);
});

it('stops analysis for reduced motion and does not render the spectrum', async () => {
	const view = render(PelletSpectrum, { track: new EventTarget() as MediaStreamTrack });
	await tick();
	media.matches = true;
	change();
	await tick();
	expect(view.queryByTestId('pellet-voice-spectrum')).toBeNull();
	expect(fixture.stop).toHaveBeenCalledOnce();
});
