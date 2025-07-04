<script lang="ts">
	import { notify, type Toast, type ToastType } from '$lib/utils/notify';
	import {
		faCircleCheck,
		faCircleExclamation,
		faCircleInfo,
		faTriangleExclamation,
		type IconDefinition
	} from '@fortawesome/free-solid-svg-icons';
	import Fa from 'svelte-fa';
	import { fade } from 'svelte/transition';

	let toasts: Toast[] = $state([]);

	notify.subscribe((value) => {
		toasts = value;
	});

	const alertClassMap = {
		default: '',
		success: 'alert-success',
		error: 'alert-error',
		info: 'alert-info',
		warning: 'alert-warning'
	};

	const alertIconMap: Record<ToastType, IconDefinition | undefined> = {
		default: undefined,
		success: faCircleCheck,
		error: faCircleExclamation,
		info: faCircleInfo,
		warning: faTriangleExclamation
	};
</script>

<div class="toast z-100">
	<div class="stack">
		{#each toasts as toast (toast.id)}
			<div
				class={`alert ${alertClassMap[toast.type]} animate-in fade-in slide-in-from-right pointer-events-auto text-lg transition duration-300`}
				in:fade={{ duration: 300 }}
				out:fade={{ duration: 300 }}
			>
				<Fa icon={alertIconMap[toast.type]!} />
				<span>{toast.message}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.fade-in {
		animation: fadeIn 0.3s ease-out;
	}

	.slide-in-from-right {
		transform: translateX(100%);
		animation: slideIn 0.3s forwards;
	}

	@keyframes slideIn {
		to {
			transform: translateX(0);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
