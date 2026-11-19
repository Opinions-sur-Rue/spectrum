<script lang="ts">
	import { icons, type IconName } from './icons';
	let { name, size }: { name: IconName; size?: number } = $props();
</script>

<span
	aria-hidden="true"
	class="iconoir-icon"
	style:width={size === undefined ? 'var(--v2-control-icon, 18px)' : `${size}px`}
	style:height={size === undefined ? 'var(--v2-control-icon, 18px)' : `${size}px`}
	style:--icon={`url(${JSON.stringify(icons[name])})`}
></span>

<style>
	.iconoir-icon {
		display: inline-block;
		flex-shrink: 0;
		vertical-align: middle;
		background: currentColor;
		mask: var(--icon) center / contain no-repeat;
	}
</style>
