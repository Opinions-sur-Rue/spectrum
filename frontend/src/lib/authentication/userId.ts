import { v7 as uuidv7 } from 'uuid';

export const STORAGE_KEY = 'spectrum-userId';

export function getUserId() {
	let userId = localStorage.getItem(STORAGE_KEY);
	if (!userId) {
		const newUserId = uuidv7().toString();
		localStorage.setItem(STORAGE_KEY, newUserId);
		userId = newUserId;
	}
	return userId;
}
