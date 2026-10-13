<script lang="ts">
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import FileBracesIcon from '@lucide/svelte/icons/file-braces';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import ListIndentIncreaseIcon from '@lucide/svelte/icons/list-indent-increase';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import sample from '#lib/assets/sample.json?raw';
	import ExportMenu from '#lib/components/export-menu.svelte';
	import GithubIcon from '#lib/components/github-icon.svelte';
	import Logo from '#lib/components/logo.svelte';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as Resizable from '#lib/components/ui/resizable/index.js';
	import { JsonEditor } from '#lib/editor/json-editor.js';
	import { formatJson } from '#lib/format/format.js';
	import { GraphController, ZOOM_STEP } from '#lib/graph/controller.js';
	import type { EngineEvent, ExportOptions, GraphStats, LoadEvent } from '#lib/graph/protocol.js';
	import { SITE } from '#lib/site.js';
	import { toggleTheme } from '#lib/theme.js';

	/** Larger files are shown as a graph only: a text editor cannot hold them. */
	const EDITOR_LIMIT = 5 * 1024 * 1024;
	const REPOSITORY = 'https://github.com/akshaybabloo/json2graph';
	const LABELS = { reading: 'Reading', parsing: 'Indexing', layout: 'Laying out' };
	/** Name of a document that was typed rather than opened. */
	const UNTITLED = 'untitled.json';

	let controller: GraphController | undefined;
	let editor: JsonEditor | undefined;
	let opened = 0;

	let name = $state(UNTITLED);
	/** Whether the engine that draws the graph has loaded, and why not if it failed to. */
	let engineReady = $state(false);
	let engineError = $state<string | null>(null);
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

	/** What the graph is, for those who cannot see the canvas. */
	const graphLabel = $derived(
		stats
			? `Graph of ${name}: ${count(stats.boxes, 'node')}, ${count(stats.values, 'value')}`
			: 'Graph: no document'
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
		return () => {
			controller?.destroy();
			controller = undefined;
		};
	}

	function source(parent: HTMLElement) {
		editor = new JsonEditor(parent, onEdit, format);
		return () => {
			editor?.destroy();
			editor = undefined;
		};
	}

	function onEvent(event: LoadEvent | EngineEvent) {
		if (event.type === 'engine') {
			engineReady = event.error === null;
			engineError = event.error;
			return;
		}
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

	/** Re-indents the document in the editor. Text that is not JSON is left as it is. */
	async function format() {
		const text = editor?.text ?? '';
		if (text.trim() === '') return;
		try {
			const formatted = await formatJson(text);
			// Not over what was typed in the meantime.
			if (editor?.text === text) editor.replace(formatted);
		} catch (reason) {
			// The error of the graph, if it is on screen, says where the mistake is.
			error ??= `Cannot format: ${reason instanceof Error ? reason.message : reason}`;
		}
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

	/** Opens the sample document. */
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
	async function exportImage(options: ExportOptions) {
		const blob = await controller?.exportImage(options);
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
		{ label: 'Fit to view', icon: MaximizeIcon, run: () => controller?.fit() }
	];
</script>

<svelte:head>
	<title>{SITE.title}</title>
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
	<a
		href="#graph"
		class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
	>
		Skip to the graph
	</a>
	<header class="flex items-center gap-2 border-b px-4 py-2 text-sm">
		<h1 class="mr-2 flex items-center gap-1.5 font-semibold">
			<Logo class="size-6" />
			<span>json<span class="text-(--brand)">2</span>graph</span>
		</h1>
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
		<Button
			variant="outline"
			size="sm"
			disabled={tooLarge !== null}
			title="Format the JSON (Shift+Alt+F in the editor)"
			onclick={format}
		>
			<ListIndentIncreaseIcon />
			Format
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
		<Button
			variant="ghost"
			size="icon-sm"
			href={REPOSITORY}
			target="_blank"
			rel="noreferrer"
			aria-label="json2graph on GitHub"
			title="json2graph on GitHub"
		>
			<GithubIcon />
		</Button>
	</header>

	<main class="flex min-h-0 flex-1">
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
								<span class="font-medium text-foreground">{name}</span> is {bytes(tooLarge)}, which
								is too large to edit as text. The graph shows the whole file.
							</p>
						</div>
					{/if}
				</section>
			</Resizable.Pane>

			<Resizable.Handle withHandle aria-label="Resize the editor and the graph" />

			<!-- Sized like the other pane: before the page's script runs, a pane has only this to go by. -->
			<Resizable.Pane defaultSize={72}>
				<section class="relative h-full" aria-label="Graph">
					<!--
						The canvas takes the keys that move the view (see GraphController),
						which no standard widget does: that is what the application role is for.
					-->
					<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
					<canvas
						{@attach graph}
						id="graph"
						class="absolute inset-0 h-full w-full touch-none outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
						role="application"
						tabindex="0"
						aria-label={graphLabel}
						aria-describedby="graph-help"
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
						<ExportMenu disabled={!stats} onexport={exportImage} />
					</div>

					{#if progress}
						<div
							class="absolute inset-x-0 top-0 h-1 bg-muted"
							role="progressbar"
							aria-label={progress.label}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(progress.fraction * 100)}
						>
							<div class="h-full bg-primary" style:width="{progress.fraction * 100}%"></div>
						</div>
					{/if}

					{#if engineError !== null}
						<div class="absolute inset-0 grid place-items-center p-6 text-center text-sm">
							<p class="max-w-sm text-destructive" role="alert">
								The graph engine could not be loaded, so no graph can be drawn: {engineError}.
								Reload the page to try again.
							</p>
						</div>
					{:else if !engineReady}
						<p
							class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
							role="status"
						>
							<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
							Loading the graph engine…
						</p>
					{:else if !stats && !progress && !error && tooLarge === null}
						<div
							class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm"
						>
							<p class="max-w-xs text-muted-foreground">
								Type or paste JSON on the left, open a file, or drop one anywhere on the page.
								<span class="font-medium text-foreground">Example</span> loads a sample document.
							</p>
						</div>
					{/if}

					<p
						id="graph-help"
						class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground"
					>
						Drag to pan · scroll to zoom · click a shortened value to expand it
						<span class="sr-only">
							With the keyboard: the arrow keys pan, plus and minus zoom, and zero fits the graph.
						</span>
					</p>
				</section>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</main>

	{#if dragging}
		<div
			class="pointer-events-none fixed inset-2 grid place-items-center rounded-lg border-2 border-dashed border-ring bg-muted/70 text-sm font-medium"
		>
			Drop a JSON file to open it
		</div>
	{/if}
</div>
