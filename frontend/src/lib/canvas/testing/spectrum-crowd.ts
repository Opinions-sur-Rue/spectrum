import { mount, unmount, tick } from 'svelte';
import SpectrumBoard from '../SpectrumBoard.svelte';
import type { RoomState, SpectrumState } from '../room-client';

/** Rendering fixture only: never creates users, permissions or network messages. */
export async function mountCrowd(target: HTMLElement, scale: number) {
	const members = Array.from({ length: 40 }, (_, i) => ({
		id: `fixture_${String(i).padStart(2, '0')}`,
		nickname: 'Long matching nickname',
		role: 'participant' as const
	}));
	const pellets = members.map((member) => ({
		memberId: member.id,
		nickname: member.nickname,
		x: 490,
		y: 367.5,
		color: 'cc6622',
		version: 1
	}));
	const component = mount(SpectrumBoard, {
		target,
		props: {
			room: { roomId: 'fixture', userId: members[0].id, role: 'participant', members } as RoomState,
			state: { revision: 1, topic: '', sliceCount: 7, hidden: false, pellets } as SpectrumState,
			cells: [],
			labels: '',
			ready: false,
			scale,
			send: () => {
				throw new Error('Rendering must not send');
			}
		}
	});
	await tick();
	return () => unmount(component);
}
