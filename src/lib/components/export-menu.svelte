<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ImageDownIcon from '@lucide/svelte/icons/image-down';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
	import type { ExportOptions } from '#lib/graph/protocol.js';

	let {
		disabled = false,
		onexport
	}: { disabled?: boolean; onexport: (options: ExportOptions) => void } = $props();

	const LABEL = 'Export as image';
	const id = $props.id();

	// The choices outlast the popover, so the next export starts from the last one.
	let open = $state(false);
	let background = $state<'theme' | 'transparent' | 'custom'>('theme');
	let color = $state('#ffffff');
	let grid = $state(true);

	function run() {
		open = false;
		onexport({
			background: background === 'theme' ? undefined : background === 'custom' ? color : background,
			grid
		});
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
		{disabled}
		aria-label={LABEL}
		title={LABEL}
	>
		<ImageDownIcon />
	</Popover.Trigger>
	<Popover.Content side="left" align="start" sideOffset={12} class="w-60">
		<Popover.Title>{LABEL}</Popover.Title>

		<div class="flex flex-col gap-2.5">
			<p id="{id}-background" class="text-xs font-medium text-muted-foreground">Background</p>
			<RadioGroup.Root bind:value={background} aria-labelledby="{id}-background">
				<div class="flex items-center gap-2">
					<RadioGroup.Item value="theme" id="{id}-theme" />
					<Label for="{id}-theme">Current</Label>
				</div>
				<div class="flex items-center gap-2">
					<RadioGroup.Item value="transparent" id="{id}-transparent" />
					<Label for="{id}-transparent">Transparent</Label>
				</div>
				<div class="flex items-center gap-2">
					<RadioGroup.Item value="custom" id="{id}-custom" />
					<Label for="{id}-custom">Custom colour</Label>
					<input
						type="color"
						class="ml-auto h-6 w-9 cursor-pointer rounded-sm border bg-transparent p-0"
						aria-label="Background colour"
						bind:value={color}
						onclick={() => (background = 'custom')}
						oninput={() => (background = 'custom')}
					/>
				</div>
			</RadioGroup.Root>
		</div>

		<div class="flex items-center gap-2">
			<Checkbox id="{id}-grid" bind:checked={grid} />
			<Label for="{id}-grid">Keep grid</Label>
		</div>

		<Button size="sm" onclick={run}>
			<DownloadIcon />
			Export
		</Button>
	</Popover.Content>
</Popover.Root>
