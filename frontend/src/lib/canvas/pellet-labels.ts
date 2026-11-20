export interface LabelAnchor {
	id: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
}
export interface LabelPlacement {
	lift: number;
	hidden: boolean;
}

/** Distinguish equal nicknames without changing server identity or profile text. */
export function participantNames(
	members: { id: string; nickname: string }[]
): Record<string, string> {
	const groups = new Map<string, { id: string; nickname: string }[]>();
	for (const member of members) {
		const key = member.nickname.trim().toLocaleLowerCase();
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(member);
	}
	const names: Record<string, string> = {};
	for (const group of groups.values()) {
		group.sort((a, b) => a.id.localeCompare(b.id));
		group.forEach((member, index) => {
			names[member.id] = group.length > 1 ? `${member.nickname} · ${index + 1}` : member.nickname;
		});
	}
	return names;
}

/** Bounded screen-space lanes; never move the actual opinion/pellet coordinates. */
export function placePelletLabels(
	anchors: LabelAnchor[],
	ownId: string
): Record<string, LabelPlacement> {
	const placed: { left: number; right: number; top: number; bottom: number }[] = [];
	const result: Record<string, LabelPlacement> = {};
	const sorted = [...anchors].sort(
		(a, b) => Number(b.id === ownId) - Number(a.id === ownId) || a.id.localeCompare(b.id)
	);
	for (const anchor of sorted) {
		let placement: LabelPlacement = { lift: 0, hidden: true };
		for (let lane = 0; lane < 4; lane++) {
			const height = anchor.height ?? 24;
			const lift = lane * Math.ceil(height + 4);
			const width = anchor.width ?? 154;
			const rect = {
				left: anchor.x - width / 2,
				right: anchor.x + width / 2,
				top: anchor.y - lift - height,
				bottom: anchor.y - lift
			};
			if (
				placed.some(
					(other) =>
						rect.left < other.right + 4 &&
						rect.right > other.left - 4 &&
						rect.top < other.bottom + 4 &&
						rect.bottom > other.top - 4
				)
			)
				continue;
			placed.push(rect);
			placement = { lift, hidden: false };
			break;
		}
		result[anchor.id] = placement;
	}
	return result;
}
