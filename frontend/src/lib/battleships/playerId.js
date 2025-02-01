import { v7 as uuidv7 } from 'uuid';

export function getPlayerId() {
	let playerId = localStorage.getItem('playerId');
	if (!playerId) {
		const newPlayerId = uuidv7().toString();
		localStorage.setItem('playerId', newPlayerId);
		playerId = newPlayerId;
	}
	return playerId;
}
