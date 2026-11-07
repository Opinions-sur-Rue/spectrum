<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { RoomState, ReactionEvent } from './room-client';
	import { toolbarMenu } from './toolbar-menu';
	let {
		room,
		ready,
		reaction,
		send
	}: {
		room: RoomState;
		ready: boolean;
		reaction: ReactionEvent | null;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	const own = $derived(room.members.find((member) => member.id === room.userId));
	let entries = $state<(ReactionEvent & { id: number; expires: number })[]>([]);
	let sequence = 0;
	let lastReaction: ReactionEvent | null = null;
	let cooldown = $state(false);
	let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const incoming = reaction;
		if (incoming === lastReaction) return;
		lastReaction = incoming;
		if (incoming?.roomId === room.roomId)
			untrack(() => {
				entries = [
					...entries.slice(-4),
					{ ...incoming, id: ++sequence, expires: Date.now() + 2000 }
				];
			});
	});
	onMount(() => {
		const timer = setInterval(() => {
			entries = entries.filter((entry) => entry.expires > Date.now());
		}, 500);
		return () => {
			clearInterval(timer);
			clearTimeout(cooldownTimer);
		};
	});
</script>

<div class="flex items-center gap-1">
	<button
		type="button"
		class="btn btn-sm btn-ghost"
		data-testid="hand-toggle"
		aria-pressed={!!own?.handRaisedAt}
		disabled={!ready}
		onclick={() => send('room.hand', { raised: !own?.handRaisedAt })}
		><span aria-hidden="true">✋</span><span class="hidden sm:inline"
			>{own?.handRaisedAt ? m.social_lower_hand() : m.social_raise_hand()}</span
		><span class="sr-only sm:hidden"
			>{own?.handRaisedAt ? m.social_lower_hand() : m.social_raise_hand()}</span
		></button
	>
	{#if room.role !== 'spectator'}<details class="relative z-40" use:toolbarMenu>
			<summary
				class="toolbar-summary"
				aria-label={m.social_reactions()}
				title={m.social_reactions()}><span aria-hidden="true">☺</span></summary
			>
			<div
				class="toolbar-popover bg-base-100 flex w-64 flex-wrap justify-center gap-1 rounded-xl border p-3 shadow-xl"
			>
				{#each ['👍', '👎', '❤️', '👏', '🤔', '😂'] as emoji (emoji)}<button
						type="button"
						class="btn btn-sm btn-ghost text-xl"
						aria-label={m.social_react({ emoji })}
						disabled={!ready || cooldown}
						onclick={() => {
							if (send('room.react', { emoji })) {
								cooldown = true;
								cooldownTimer = setTimeout(() => {
									cooldown = false;
								}, 1100);
							}
						}}>{emoji}</button
					>{/each}
			</div>
		</details>{/if}
</div>
<div
	class="reaction-overlay"
	role="status"
	aria-live="polite"
	aria-atomic="false"
	data-testid="room-reactions"
>
	{#each entries as entry, index (entry.id)}<div
			class="reaction-burst"
			data-reaction-member={entry.memberId}
			style:left="{45 + index * 3}%"
			style:top="{45 + index * 2}%"
		>
			<span class="sr-only"
				>{m.social_reaction_from({ name: entry.nickname, emoji: entry.emoji })}</span
			>
			<div aria-hidden="true">
				<span class="reaction-emoji">{entry.emoji}</span>
				{#each Array.from({ length: 12 }, (_, i) => i) as particle (particle)}<span
						class="reaction-particle"
						style:--x="{Math.cos((particle * Math.PI) / 6) * 140}px"
						style:--y="{Math.sin((particle * Math.PI) / 6) * 140}px"
						style:animation-delay="{particle * 15}ms">{entry.emoji}</span
					>{/each}
				<span class="reaction-caption">{entry.nickname}</span>
			</div>
		</div>{/each}
</div>

<style>
	.reaction-overlay {
		position: fixed;
		inset: 0;
		z-index: 55;
		pointer-events: none;
		overflow: hidden;
	}
	.reaction-burst {
		position: absolute;
		width: 0;
		height: 0;
	}
	.reaction-emoji {
		position: absolute;
		font-size: clamp(72px, 12vw, 144px);
		line-height: 1;
		animation: reaction-pop 1.7s ease-out both;
	}
	.reaction-particle {
		position: absolute;
		font-size: 28px;
		animation: reaction-scatter 1.3s ease-out both;
	}
	.reaction-caption {
		position: absolute;
		top: 80px;
		left: 0;
		transform: translateX(-50%);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-radius: 999px;
		padding: 5px 12px;
		background: var(--color-base-100);
		color: var(--color-base-content);
		font-size: 13px;
	}
	@keyframes reaction-pop {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.25);
		}
		22% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.12);
		}
		42%,
		70% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -65%) scale(0.85);
		}
	}
	@keyframes reaction-scatter {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.4);
		}
		15% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(0.6);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.reaction-particle {
			display: none;
			animation: none;
		}
		.reaction-emoji {
			animation: none;
			transform: translate(-50%, -50%);
		}
	}
</style>
