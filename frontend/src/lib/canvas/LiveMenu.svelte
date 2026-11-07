<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import { toolbarMenu } from './toolbar-menu';
	import type { LiveState } from './room-client';
	let {
		state: live,
		ready,
		slices,
		send
	}: {
		state: LiveState | null;
		ready: boolean;
		slices: number;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
	let platform = $state('twitch');
	let channel = $state('');
	let secret = $state('');
	let search = $state('');
	const active = $derived(!!live?.platform);
	const users = $derived(
		(live?.users ?? []).filter((user) =>
			user.nickname.toLocaleLowerCase().includes(search.toLocaleLowerCase())
		)
	);
</script>

<details class="relative z-40" use:toolbarMenu>
	<summary class="toolbar-summary" aria-label={m.v2_live()} title={m.v2_live()}
		><Icon name="speaker" />{#if live?.status === 'connected'}<span
				class="h-2 w-2 rounded-full bg-emerald-700"
			></span>{/if}</summary
	>
	<div
		class="toolbar-popover bg-base-100 w-80 space-y-3 overflow-y-auto rounded-xl border p-4 shadow-xl"
		data-testid="live-panel"
	>
		<h2 class="text-sm font-semibold">{m.v2_live()}</h2>
		<p class="text-xs opacity-70">{m.v2_live_privacy()}</p>
		<p class="rounded border p-2 text-xs">{m.v2_live_command({ max: String((slices - 1) / 2) })}</p>
		{#if !active}<form
				class="space-y-2"
				onsubmit={(event) => {
					event.preventDefault();
					if (send('live.connect', { platform, channel: channel.trim(), secret })) secret = '';
				}}
			>
				<label class="block text-xs"
					>{m.platform()}<select
						class="select select-sm w-full"
						data-testid="live-platform"
						bind:value={platform}
						onchange={() => {
							secret = '';
						}}
						><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option
							value="tiktok"
							disabled={!live?.tiktokAvailable}>TikTok</option
						></select
					></label
				>
				{#if !live?.tiktokAvailable}<p class="text-xs opacity-60">
						{m.v2_live_tiktok_disabled()}
					</p>{/if}
				<label class="block text-xs"
					>{m.v2_live_channel()}<input
						class="input input-sm w-full"
						data-testid="live-channel"
						maxlength="100"
						required
						bind:value={channel}
					/></label
				>
				{#if platform !== 'twitch'}<label class="block text-xs"
						>{m.v2_live_secret()}<input
							type="password"
							class="input input-sm w-full"
							autocomplete="off"
							maxlength="4096"
							bind:value={secret}
						/></label
					>{/if}
				<button
					type="submit"
					class="btn btn-sm btn-primary w-full"
					disabled={!ready || !channel.trim()}>{m.connect_live()}</button
				>
			</form>{:else}
			<p role="status" class="text-xs">
				{live?.platform} · {live?.status === 'connected'
					? m.v2_live_connected()
					: live?.status === 'error'
						? m.v2_live_error()
						: live?.status === 'disconnected'
							? m.v2_live_disconnected()
							: m.v2_live_connecting()}
			</p>
			<button
				type="button"
				class="btn btn-sm w-full"
				disabled={!ready}
				onclick={() => send('live.disconnect', {})}>{m.disconnect_live()}</button
			>
		{/if}
		<p class="text-xs opacity-60">
			{m.v2_live_limit({ count: String(live?.count ?? 0), limit: String(live?.limit ?? 1000) })}
		</p>
		<input
			type="search"
			class="input input-sm w-full"
			aria-label={m.v2_live_search()}
			bind:value={search}
		/>
		<ul class="max-h-52 space-y-2 overflow-y-auto">
			{#each users as user (user.id)}<li>
					<label class="flex items-center gap-2 text-xs"
						><input
							type="checkbox"
							class="checkbox checkbox-xs"
							aria-label={m.v2_live_select({ name: user.nickname })}
							checked={user.selected}
							disabled={!ready}
							onchange={(event) =>
								send('live.select', { id: user.id, selected: event.currentTarget.checked })}
						/><span class="min-w-0 flex-1 truncate">{user.nickname}</span><span
							>{user.vote ?? 'i'}</span
						></label
					>
				</li>{:else}<li class="text-xs opacity-60">{m.v2_live_none()}</li>{/each}
		</ul>
	</div>
</details>
