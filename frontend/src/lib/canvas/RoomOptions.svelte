<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import { toolbarMenu } from './toolbar-menu';
	import type { RoomState, SpectrumState } from './room-client';
	let {
		room,
		spectrum,
		ready,
		send
	}: {
		room: RoomState;
		spectrum: SpectrumState | null;
		ready: boolean;
		send: (op: string, payload: unknown) => boolean;
	} = $props();
</script>

<details class="relative z-40" use:toolbarMenu>
	<summary class="toolbar-summary" aria-label={m.ux_room_options()} title={m.ux_room_options()}
		><Icon name="settings" /><span class="hidden text-xs sm:inline">{m.ux_room_menu_short()}</span
		></summary
	>
	<div class="toolbar-popover bg-base-100 w-80 overflow-y-auto rounded-xl border p-4 shadow-xl">
		<h2 class="mb-4 text-sm font-semibold">{m.ux_room_options()}</h2>
		<fieldset class="space-y-3">
			<legend class="mb-3 text-xs font-semibold opacity-60">{m.ux_spectrum_settings()}</legend>
			<label class="block text-xs"
				>{m.spectrum_slices()}<select
					class="select select-sm mt-1 w-full"
					data-testid="spectrum-slice-count"
					aria-label={m.spectrum_slices()}
					value={spectrum?.sliceCount ?? 7}
					disabled={!ready}
					onchange={(event) =>
						send('spectrum.configure', { sliceCount: Number(event.currentTarget.value) })}
					>{#each [3, 5, 7, 9] as count (count)}<option value={count}>{count}</option
						>{/each}</select
				></label
			>
			<label class="flex items-center gap-2 text-xs" title={m.show_neutral_circle_tooltip()}
				><input
					type="checkbox"
					class="checkbox checkbox-xs"
					data-testid="spectrum-neutral-circle"
					checked={spectrum?.showNeutralCircle ?? true}
					disabled={!ready}
					onchange={(event) =>
						send('spectrum.configure', { showNeutralCircle: event.currentTarget.checked })}
				/>{m.show_neutral_circle()}</label
			>
		</fieldset>
		<fieldset class="mt-5 space-y-3 border-t pt-4">
			<legend class="text-xs font-semibold opacity-60">{m.ux_visibility_settings()}</legend>
			<label class="flex items-center gap-2 text-xs"
				><input
					type="checkbox"
					class="checkbox checkbox-xs"
					checked={room.settings.spectatorChatEnabled}
					disabled={!ready}
					onchange={(event) =>
						send('room.settings', { spectatorChatEnabled: event.currentTarget.checked })}
				/>{m.ux_allow_spectator_chat()}</label
			>
			<label class="flex items-center gap-2 text-xs"
				><input
					type="checkbox"
					class="checkbox checkbox-xs"
					checked={room.settings.notesVisibleToSpectators}
					disabled={!ready}
					onchange={(event) =>
						send('room.settings', { notesVisibleToSpectators: event.currentTarget.checked })}
				/>{m.ux_show_revealed_notes()}</label
			>
			<label class="flex items-center gap-2 text-xs"
				><input
					type="checkbox"
					class="checkbox checkbox-xs"
					checked={room.settings.pelletsVisibleToSpectators}
					disabled={!ready}
					onchange={(event) =>
						send('room.settings', { pelletsVisibleToSpectators: event.currentTarget.checked })}
				/>{m.ux_show_positions()}</label
			>
			<label class="flex items-center gap-2 text-xs"
				><input
					type="checkbox"
					class="checkbox checkbox-xs"
					checked={spectrum?.hidden ?? false}
					disabled={!ready}
					onchange={(event) =>
						send('room.settings', { pelletsHidden: event.currentTarget.checked })}
				/>{m.ux_hide_positions()}</label
			>
		</fieldset>
		{#if room.transcription?.available}<fieldset class="mt-5 space-y-3 border-t pt-4">
				<legend class="text-xs font-semibold opacity-60">{m.ux_transcription_settings()}</legend>
				<label class="block text-xs"
					>{m.ux_transcript_language()}<select
						class="select select-sm mt-1 w-full"
						aria-label={m.ux_transcript_language()}
						value={room.settings.transcriptionLanguage ?? 'fr'}
						disabled={!ready}
						onchange={(event) =>
							send('room.settings', { transcriptionLanguage: event.currentTarget.value })}
						><option value="fr">Français</option><option value="en">English</option><option
							value="auto">Auto (FR/EN)</option
						></select
					></label
				>
				<label class="flex items-center gap-2 text-xs"
					><input
						type="checkbox"
						class="checkbox checkbox-xs"
						checked={room.settings.transcriptionEnabled}
						disabled={!ready}
						onchange={(event) =>
							send('room.settings', { transcriptionEnabled: event.currentTarget.checked })}
					/>{m.ux_transcription_enabled()}</label
				>
				<p class="text-[11px] leading-relaxed opacity-60">{m.ux_voice_restart_warning()}</p>
			</fieldset>{/if}
		<div class="mt-5 flex items-center gap-2 border-t pt-4">
			<IconButton
				icon="reset"
				label={m.v2_reset_positions()}
				disabled={!ready}
				onclick={() => send('spectrum.reset', {})}
			/><span class="text-xs">{m.ux_reset_positions()}</span>
		</div>
	</div>
</details>
