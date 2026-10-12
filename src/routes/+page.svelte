<script lang="ts">
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import FileBracesIcon from '@lucide/svelte/icons/file-braces';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import ImageDownIcon from '@lucide/svelte/icons/image-down';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import sample from '#lib/assets/sample.json?raw';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as Resizable from '#lib/components/ui/resizable/index.js';
	import { JsonEditor } from '#lib/editor/json-editor.js';
	import { GraphController } from '#lib/graph/controller.js';
	import type { GraphStats, LoadEvent } from '#lib/graph/protocol.js';
	import { toggleTheme } from '#lib/theme.js';

	/** Larger files are shown as a graph only: a text editor cannot hold them. */
	const EDITOR_LIMIT = 5 * 1024 * 1024;
	const LABELS = { reading: 'Reading', parsing: 'Indexing', layout: 'Laying out' };
	/** Name of a document that was typed rather than opened. */
	const UNTITLED = 'untitled.json';
	/** How much one press of a zoom button magnifies. */
	const ZOOM_STEP = 1.4;

	let controller: GraphController | undefined;
	let editor: JsonEditor | undefined;
	let opened = 0;

	let name = $state('sample.json');
	let stats = $state<GraphStats | null>(null);
	let progress = $state<{ label: string; fraction: number } | null>(null);
	let error = $state<string | null>(null);
	/** Size of the open file when it is too large for the editor. */
	let tooLarge = $state<number | null>(null);
	let dragging = $state(false);

	const number = new Intl.NumberFormat();

	function count(n: number, noun: string): string {
		return `${number.format(n)} ${noun}${n === 1 ? '' : 's'}`;
	}

	/** Size, node and value counts and load time of the graph on screen. */
	const summary = $derived(
		stats &&
			[
				bytes(stats.bytes),
				count(stats.boxes, 'node'),
				count(stats.values, 'value'),
				duration(stats.ms)
			].join(' · ')
	);

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return `${(n / 1024 ** 3).toFixed(2)} GB`;
	}

	function duration(ms: number): string {
		return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
	}

	function graph(canvas: HTMLCanvasElement) {
		controller = new GraphController(canvas, onEvent);
		controller.load(new Blob([sample]));
		return () => {
			controller?.destroy();
			controller = undefined;
		};
	}

	function source(parent: HTMLElement) {
		editor = new JsonEditor(parent, onEdit);
		editor.setText(sample);
		return () => {
			editor?.destroy();
			editor = undefined;
		};
	}

	function onEvent(event: LoadEvent) {
		if (event.type === 'progress') {
			progress = { label: LABELS[event.phase], fraction: event.fraction };
			return;
		}
		progress = null;
		if (event.type === 'ready') {
			stats = event.stats;
			error = null;
		} else {
			error = event.message;
		}
	}

	/** An edit redraws the graph in place; while the text is invalid the last graph stays. */
	function onEdit(text: string) {
		if (text.trim() === '') clearGraph();
		else controller?.load(new Blob([text]), { keepView: true });
	}

	/** Removes the graph: an empty document has none, and is not an error. */
	function clearGraph() {
		stats = null;
		error = null;
		progress = null;
		controller?.clear();
	}

	/** Empties the editor and the graph, ready for a new document. */
	function clear() {
		// Abandon a file that is still being read.
		opened += 1;
		name = UNTITLED;
		tooLarge = null;
		editor?.setText('');
		clearGraph();
	}

	async function open(file: File) {
		const id = ++opened;
		name = file.name;
		error = null;
		controller?.load(file);
		if (file.size > EDITOR_LIMIT) {
			tooLarge = file.size;
			stats = null;
			editor?.setText('');
			return;
		}
		tooLarge = null;
		const text = await file.text();
		if (id === opened) editor?.setText(text);
	}

	/** Opens the document the page starts with. */
	function openExample() {
		open(new File([sample], 'sample.json', { type: 'application/json' }));
	}

	function onPick(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (file) open(file);
		// Allow picking the same file again.
		input.value = '';
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function onDragOver(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragging = true;
	}

	function onDrop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragging = false;
		const file = event.dataTransfer?.files[0];
		if (file) open(file);
	}

	/** Saves the graph as a PNG named after the document. */
	async function exportImage() {
		const blob = await controller?.exportImage();
		if (!blob) return;
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `${name.replace(/\.json$/i, '')}.png`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	const tools = [
		{ label: 'Zoom in', icon: ZoomInIcon, run: () => controller?.zoomBy(ZOOM_STEP) },
		{ label: 'Zoom out', icon: ZoomOutIcon, run: () => controller?.zoomBy(1 / ZOOM_STEP) },
		{ label: 'Fit to view', icon: MaximizeIcon, run: () => controller?.fit() },
		{ label: 'Export as image', icon: ImageDownIcon, run: exportImage }
	];
</script>

<svelte:head>
	<title>json2graph</title>
</svelte:head>

<svelte:window
	ondragover={onDragOver}
	ondragleave={(event) => {
		// Only when the pointer leaves the window, not when it crosses elements.
		if (!event.relatedTarget) dragging = false;
	}}
	ondrop={onDrop}
/>

<div class="flex h-dvh flex-col">
	<header class="flex items-center gap-2 border-b px-4 py-2 text-sm">
		<h1 class="mr-2 font-semibold">json2graph</h1>
		<label
			class={[
				buttonVariants({ variant: 'outline', size: 'sm' }),
				'cursor-pointer focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50'
			]}
		>
			<FolderOpenIcon />
			Open file
			<input type="file" accept=".json,application/json" class="sr-only" onchange={onPick} />
		</label>
		<Button variant="outline" size="sm" onclick={openExample}>
			<FileBracesIcon />
			Example
		</Button>
		<Button variant="outline" size="sm" onclick={clear}>
			<EraserIcon />
			Clear
		</Button>
		<p class="ml-auto truncate text-muted-foreground" aria-live="polite">
			<span class="font-medium text-foreground">{name}</span>
			{#if progress}
				· {progress.label}…
			{:else if summary}
				· {summary}
			{/if}
		</p>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Switch between light and dark mode"
			title="Switch between light and dark mode"
			onclick={toggleTheme}
		>
			<SunIcon class="dark:hidden" />
			<MoonIcon class="hidden dark:block" />
		</Button>
	</header>

	<Resizable.PaneGroup direction="horizontal" class="min-h-0 flex-1">
		<Resizable.Pane defaultSize={28} minSize={12} maxSize={70}>
			<section class="relative flex h-full flex-col" aria-label="JSON source">
				<div class="min-h-0 flex-1" {@attach source}></div>

				{#if error}
					<p class="border-t px-3 py-1.5 text-xs text-destructive" role="alert">{error}</p>
				{/if}

				{#if tooLarge !== null}
					<div
						class="absolute inset-0 grid place-items-center bg-background p-6 text-center text-sm"
					>
						<p class="max-w-xs text-muted-foreground">
							<span class="font-medium text-foreground">{name}</span> is {bytes(tooLarge)}, which is
							too large to edit as text. The graph shows the whole file.
						</p>
					</div>
				{/if}
			</section>
		</Resizable.Pane>

		<Resizable.Handle withHandle />

		<Resizable.Pane>
			<main class="relative h-full">
				<canvas
					{@attach graph}
					class="absolute inset-0 h-full w-full touch-none"
					aria-label="Graph of the JSON document"
				></canvas>

				<div
					class="absolute top-3 right-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-xs"
					role="toolbar"
					aria-label="Graph view"
					aria-orientation="vertical"
				>
					{#each tools as tool (tool.label)}
						<Button
							variant="ghost"
							size="icon-sm"
							disabled={!stats}
							aria-label={tool.label}
							title={tool.label}
							onclick={tool.run}
						>
							<tool.icon />
						</Button>
					{/each}
				</div>

				{#if progress}
					<div class="absolute inset-x-0 top-0 h-1 bg-muted">
						<div class="h-full bg-primary" style:width="{progress.fraction * 100}%"></div>
					</div>
				{/if}

				<p
					class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground"
				>
					Drag to pan · scroll to zoom · click a shortened value to expand it
				</p>
			</main>
		</Resizable.Pane>
	</Resizable.PaneGroup>

	{#if dragging}
		<div
			class="pointer-events-none fixed inset-2 grid place-items-center rounded-lg border-2 border-dashed border-ring bg-muted/70 text-sm font-medium"
		>
			Drop a JSON file to open it
		</div>
	{/if}
</div>
