import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import Page from './[[id]]/+page.svelte';

vi.mock('fabric', () => ({
	loadSVGFromURL: vi.fn().mockImplementation(() => ({
		then: vi.fn()
	})),
	Canvas: vi.fn().mockImplementation(() => ({
		setDimensions: vi.fn(),
		on: vi.fn(),
		add: vi.fn(),
		remove: vi.fn(),
		renderAll: vi.fn(),
		requestRenderAll: vi.fn(),
		dispose: vi.fn(),
		sendObjectToBack: vi.fn(),
		getWidth: vi.fn().mockReturnValue(980),
		hoverCursor: 'default',
		selection: true,
		targetFindTolerance: 0,
		backgroundColor: ''
	}))
}));

describe('/+page.svelte', () => {
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	globalThis.ResizeObserver = ResizeObserver;
	HTMLDialogElement.prototype.show = vi.fn();
	HTMLDialogElement.prototype.close = vi.fn();

	test('should render h1', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});
});
