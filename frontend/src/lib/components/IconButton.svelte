<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	let {
		icon,
		label,
		class: className = '',
		...attributes
	}: HTMLButtonAttributes & { icon: IconName; label: string } = $props();
</script>

<button
	type="button"
	{...attributes}
	class="icon-button {className}"
	aria-label={label}
	title={label}
>
	<Icon name={icon} />
</button>

<style>
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		padding: 5px;
		border: 1px solid #cbd5e1;
		border-radius: 5px;
		color: inherit;
		background: transparent;
		cursor: pointer;
	}
	.icon-button:hover:not(:disabled) {
		background: #94a3b822;
	}
	.icon-button:focus-visible {
		outline: 2px solid #3b82f6;
		outline-offset: 2px;
	}
	.icon-button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon-button[aria-pressed='true'] {
		color: #2563eb;
		border-color: #3b82f6;
		background: #dbeafe;
	}
</style>
