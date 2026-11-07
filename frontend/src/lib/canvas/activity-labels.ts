import { m } from '$lib/paraglide/messages.js';
import type { ActivityEntry } from './activity-state';
import { cellLabel } from './cells';

export function activityLabel(entry: ActivityEntry): string {
	const name = entry.nickname ?? '';
	switch (entry.kind) {
		case 'live':
			return entry.liveConnected
				? m.activity_live_connected({ platform: entry.platform ?? '' })
				: m.activity_live_disconnected({ platform: entry.platform ?? '' });
		case 'join':
			return entry.self ? m.log_you_joined_spectrum() : m.log_joined_spectrum({ name });
		case 'leave':
			return entry.self ? m.log_you_left_spectrum() : m.log_left_spectrum({ name });
		case 'topic':
			return entry.topic ? m.log_claim({ claim: entry.topic }) : m.activity_claim_cleared();
		case 'opinion': {
			const opinion = cellLabel(entry.cellId ?? null);
			return entry.self ? m.log_your_opinion({ opinion }) : m.log_opinion({ name, opinion });
		}
		case 'role':
			if (entry.role === 'admin')
				return entry.self ? m.log_you_been_made_admin() : m.log_made_admin({ name });
			return m.activity_role_changed({
				name,
				role:
					entry.role === 'participant' ? m.activity_role_participant() : m.activity_role_spectator()
			});
		case 'nickname':
			return m.activity_nickname_changed({ before: entry.previousNickname ?? '', after: name });
		case 'visibility':
			return entry.hidden ? m.log_participants_hidden() : m.log_participants_shown();
		case 'configuration':
			return m.activity_configuration({
				count: String(entry.sliceCount ?? 7),
				circle: entry.showNeutralCircle ? m.activity_circle_on() : m.activity_circle_off()
			});
		case 'reconnected':
			return m.activity_log_reconnected();
		case 'hand':
			return entry.handRaised
				? m.activity_hand_raised({ name })
				: m.activity_hand_lowered({ name });
		case 'reaction':
			return m.social_reaction_from({ name, emoji: entry.emoji ?? '' });
	}
}
