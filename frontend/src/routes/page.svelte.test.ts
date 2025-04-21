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
		requestRenderAll: vi.fn()
	}))
}));

describe('/+page.svelte', () => {
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	global.ResizeObserver = ResizeObserver;

	test('should render h1', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});
});
