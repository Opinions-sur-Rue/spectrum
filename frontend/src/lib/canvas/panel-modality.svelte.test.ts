import { expect, it } from 'vitest';
import { panelModality } from './panel-modality';

it('isolates a mobile panel and restores pre-existing inert state on close/destroy', () => {
	const host = document.createElement('div');
	host.innerHTML = '<header></header><section><main></main><aside></aside></section>';
	document.body.append(host);
	const header = host.querySelector('header')!;
	const canvas = host.querySelector('main')!;
	const panel = host.querySelector('aside')!;
	header.inert = true;
	const action = panelModality(panel, true);
	try {
		expect(canvas.inert).toBe(true);
		expect(panel.inert).not.toBe(true);
		action.update(false);
		expect(canvas.inert).not.toBe(true);
		expect(header.inert).toBe(true);
		action.update(true);
		expect(canvas.inert).toBe(true);
		action.destroy();
		expect(canvas.inert).not.toBe(true);
		expect(header.inert).toBe(true);
	} finally {
		action.destroy();
		host.remove();
	}
});
