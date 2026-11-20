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
		expect(roomErrorLabel('operation not allowed for this role', 'room_join_failed')).toBe(
			'Cette action n’est pas disponible depuis une salle. Quittez d’abord la salle actuelle.'
		);
		expect(roomErrorLabel('operation not allowed for this role')).toBe(
			'Vos droits actuels ne permettent pas cette action. Demandez à un admin si nécessaire.'
		);
		expect(roomErrorLabel('already in a room')).toBe(
			'Vous êtes déjà dans une salle. Quittez-la avant d’en rejoindre une autre.'
		);
	});

	it('replaces an unmapped protocol message with generic recovery copy', () => {
		expect(roomErrorLabel('invalid payload')).toBe(
			'Cette action n’a pas abouti. Réessayez, puis rechargez la salle si le problème persiste.'
		);
		expect(roomErrorLabel('invalid_spectrum_configuration')).toBe(
			'Cette action n’a pas abouti. Réessayez, puis rechargez la salle si le problème persiste.'
		);
	});

	it('localizes server sentences and hides unknown technical details', () => {
		expect(roomErrorLabel('The room was closed by an admin.')).toBe(
			'Cette salle est indisponible. Vérifiez le lien d’invitation ou demandez-en un nouveau.'
		);
		expect(roomErrorLabel('TypeError: failed to fetch https://internal/path?token=secret')).toBe(
			roomErrorLabel('invalid payload')
		);
	});
});
