<script lang="ts">
	import type { KeyboardEventHandler } from 'svelte/elements';

	interface Props {
		name?: string;
		value: string;
		placeholder?: string;
		readonly?: boolean;
		onfocusin?: VoidFunction;
		onfocusout?: VoidFunction;
		oninput?: VoidFunction;
		onkeydown?: KeyboardEventHandler<HTMLInputElement>;
		minFontSize: number;
		maxFontSize: number;
	}

	let {
		value = $bindable(),
		name,
		placeholder,
		readonly,
		onfocusin,
		onfocusout,
		oninput,
		onkeydown,
		minFontSize,
		maxFontSize
	}: Props = $props();
	let inputEl: HTMLInputElement;
	let mirrorEl: HTMLSpanElement;

	// Fonction de mise à jour de la taille de police
	function updateFontSize() {
		if (!inputEl || !mirrorEl) return;

		// eslint-disable-next-line svelte/no-dom-manipulating
		mirrorEl.textContent = value || ' ';

		const inputWidth = inputEl.offsetWidth - 16; // enlever un peu de padding
		let fontSize = maxFontSize;

		mirrorEl.style.fontSize = `${fontSize}px`;

		// Réduit la police jusqu'à ce que le texte tienne
		while (fontSize > minFontSize && mirrorEl.offsetWidth > inputWidth) {
			fontSize -= 1;
			mirrorEl.style.fontSize = `${fontSize}px`;
		}

		inputEl.style.fontSize = `${fontSize}px`;
	}

	$effect(() => {
		updateFontSize();
	});
</script>

<div class="wrapper">
	<input
		bind:this={inputEl}
		bind:value
		type="text"
		class="input input-xl join-item"
		{name}
		{readonly}
		{placeholder}
		{onfocusin}
		{onfocusout}
		{oninput}
		{onkeydown}
	/>
	<span class="mirror" bind:this={mirrorEl}></span>
</div>

<style>
	.wrapper {
		position: relative;
		width: 100%;
	}

	input {
		width: 100%;
		padding: 8px;
	}

	.mirror {
		position: absolute;
		top: 0;
		left: 0;
		visibility: hidden;
		white-space: pre;
		padding: 8px;
		font-weight: normal;
	}
</style>
