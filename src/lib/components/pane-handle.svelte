<script lang="ts">
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import { cn } from '#lib/utils.js';
	import { PaneResizer, type PaneResizerProps } from 'paneforge';

	/** A handle between two panes, as an editor has: a bar with a grip of three dots, lit while it is used. */
	let { class: className, ...restProps }: Omit<PaneResizerProps, 'children' | 'child'> = $props();
</script>

<PaneResizer
	class={cn(
		'group flex w-2 shrink-0 items-center justify-center border-x bg-muted text-muted-foreground transition-colors outline-none',
		'hover:bg-ring/40 hover:text-foreground data-active:bg-ring/40 data-active:text-foreground',
		'data-[direction=vertical]:h-2 data-[direction=vertical]:w-full data-[direction=vertical]:border-x-0 data-[direction=vertical]:border-y',
		className
	)}
	{...restProps}
>
	<EllipsisVerticalIcon
		class="size-3.5 shrink-0 group-data-[direction=vertical]:rotate-90"
		aria-hidden="true"
	/>
</PaneResizer>
