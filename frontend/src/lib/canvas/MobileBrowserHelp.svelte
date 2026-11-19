<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { mobileBrowser, type MobileBrowser } from './in-app-browser';
	let browser = $state<MobileBrowser | null>(null);
	let open = $state(false);
	let url = $state('');
	let copied = $state(false);
	onMount(() => {
		browser = mobileBrowser(navigator.userAgent);
		open = browser?.embedded ?? false;
	});
	$effect(() => {
		if (open) url = window.location.href;
		else copied = false;
	});
	async function copy() {
		url = window.location.href;
		copied = false;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
		} catch {
			// Read-only field remains available for native selection and copying.
		}
	}
</script>

{#if browser}
	<aside class="browser-help" aria-label={m.ux_browser_title()} data-testid="mobile-browser-help">
		<details bind:open>
			<summary>{m.ux_browser_title()}</summary>
			<p>{m.ux_browser_reason()}</p>
			<p>{browser.platform === 'android' ? m.ux_browser_android() : m.ux_browser_ios()}</p>
			<p>{m.ux_browser_privacy()}</p>
			<label>
				{m.ux_browser_link()}
				<input
					readonly
					value={url}
					onfocus={() => (url = window.location.href)}
					onclick={(event) => event.currentTarget.select()}
				/>
			</label>
			<div class="actions">
				<button class="btn btn-sm" onclick={copy}>{m.ux_browser_copy()}</button>
				<button class="btn btn-sm" onclick={() => (open = false)}>{m.ux_browser_close()}</button>
			</div>
			<span role="status">{copied ? m.ux_browser_copied() : ''}</span>
		</details>
	</aside>
{/if}

<style>
	.browser-help {
		flex-shrink: 0;
		width: 100%;
		max-height: 40dvh;
		overflow: auto;
		border: 1px solid var(--color-base-300);
		border-radius: 12px;
		background: var(--color-base-100);
		padding: 10px;
		font-size: var(--v2-text-sm);
		box-shadow: 0 4px 20px #0002;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	p,
	label,
	.actions {
		margin-top: 8px;
	}
	label {
		display: block;
	}
	input {
		width: 100%;
		border: 1px solid;
		border-radius: 4px;
		padding: 6px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
