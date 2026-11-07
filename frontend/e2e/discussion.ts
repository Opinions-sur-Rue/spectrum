import type { Page } from '@playwright/test';

/** Open the persistent discussion dock if it is closed. */
export async function openDiscussion(page: Page) {
	const toggle = page.getByTestId('discussion-toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Open the discussion dock and select one of its tabs. */
export async function openDiscussionTab(page: Page, tab: 'chat' | 'activity' | 'transcript') {
	await openDiscussion(page);
	await page.getByTestId(`discussion-tab-${tab}`).click();
}

export async function openChat(page: Page) {
	await openDiscussionTab(page, 'chat');
	return page.getByLabel('Chat message', { exact: true });
}

export async function openActivity(page: Page) {
	await openDiscussionTab(page, 'activity');
	return page.getByTestId('activity-log');
}

export async function openTranscript(page: Page) {
	await openDiscussionTab(page, 'transcript');
	return page.getByRole('log', { name: 'Transcript segments' });
}
