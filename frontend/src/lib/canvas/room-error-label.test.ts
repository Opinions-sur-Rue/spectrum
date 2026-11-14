import { describe, expect, it } from 'vitest';
import { roomErrorLabel } from './room-error-label';

describe('room error labels', () => {
	it('localizes known protocol errors', () => {
		expect(roomErrorLabel('room not found')).toBe(
			'Cette salle est indisponible. Vérifiez le lien d’invitation ou demandez-en un nouveau.'
		);
		expect(roomErrorLabel('room is full')).toBe(
			'Cette salle est complète. Réessayez plus tard ou demandez une place à l’animation.'
		);
		expect(roomErrorLabel('spectator limit reached')).toBe(
			'Cette salle est complète. Réessayez plus tard ou demandez une place à l’animation.'
		);
	});

	it('explains invitations opened from inside a room', () => {
		expect(roomErrorLabel('operation not allowed for this role')).toBe(
			'Cette action n’est pas disponible depuis une salle. Quittez d’abord la salle actuelle.'
		);
		expect(roomErrorLabel('already in a room')).toBe(
			'Vous êtes déjà dans une salle. Quittez-la avant d’en rejoindre une autre.'
		);
	});

	it('keeps an unknown server message rather than inventing a reason', () => {
		expect(roomErrorLabel('invalid payload')).toBe('invalid payload');
	});
});
