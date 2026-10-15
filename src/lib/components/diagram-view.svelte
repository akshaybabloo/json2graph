<script lang="ts" module>
	/** A diagram on screen: its kind, the size of its text, and how long it took to draw. */
	export type Diagram = { type: string; bytes: number; ms: number };
</script>

<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import type { ExportOptions } from '#lib/graph/protocol.js';
	import { drawDiagram } from '#lib/mermaid/render.js';
	import { DiagramViewport } from '#lib/mermaid/viewport.js';
	import { tick, untrack } from 'svelte';

	type Props = {
		/** The Mermaid text, or none when it is too large to be held as text. */
		text: string | null;
		/** What the diagram is, for those who cannot see it. */
		label: string;
		/** The id of what says how to move the view. */
		describedby?: string;
		/** A diagram is being drawn. */
		ondrawing: () => void;
		/** The diagram on screen was drawn, or there is none for no text. */
		ondrawn: (diagram: Diagram | null) => void;
		/** The text could not be drawn, for this reason: the last diagram stays. */
		onfailed: (message: string) => void;
	};

	let { text, label, describedby, ondrawing, ondrawn, onfailed }: Props = $props();

	let container: HTMLElement;
	let content: HTMLElement;
	let grid: HTMLCanvasElement;
	let viewport: DiagramViewport | undefined;
	/** The SVG on screen. */
	let svg = $state<string | null>(null);
	let drawing = $state(false);
	let dark = $state(isDark());
	let draws = 0;

	function isDark(): boolean {
		return document.documentElement.classList.contains('dark');
	}

	$effect(() => {
		viewport = new DiagramViewport(container, content, grid);
		return () => viewport?.destroy();
	});

	// The theme is switched by toggling a class on the root element; the diagram is drawn again in it.
	$effect(() => {
		const observer = new MutationObserver(() => (dark = isDark()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});

	$effect(() => {
		const [source, theme] = [text, dark];
		untrack(() => {
			draw(source, theme);
			// In the colour of the new theme.
			viewport?.drawGrid();
		});
	});

	async function draw(source: string | null, theme: boolean) {
		const id = ++draws;
		if (source === null || source.trim() === '') {
			svg = null;
			drawing = false;
			viewport?.update(false);
			ondrawn(null);
			return;
		}
		drawing = true;
		ondrawing();
		const started = performance.now();
		try {
			const background = getComputedStyle(container).getPropertyValue('--background').trim();
			const drawn = await drawDiagram(source, theme, background || (theme ? '#0a0a0a' : '#ffffff'));
			if (id !== draws) return;
			// The first diagram is shown whole; one drawn again over it is shown where it was.
			const keepView = svg !== null;
			svg = drawn.svg;
			await tick();
			viewport?.update(keepView);
			ondrawn({
				type: drawn.type,
				bytes: new Blob([source]).size,
				ms: performance.now() - started
			});
		} catch (error) {
			if (id !== draws) return;
			onfailed(error instanceof Error ? error.message : String(error));
		} finally {
			if (id === draws) drawing = false;
		}
	}

	export function zoomBy(factor: number) {
		viewport?.zoomBy(factor);
	}

	export function fit() {
		viewport?.fit();
	}

	/** A PNG of the whole diagram; null when there is none. */
	export function exportImage(options: ExportOptions): Promise<Blob | null> {
		const background = getComputedStyle(container).getPropertyValue('--background').trim();
		return viewport?.exportImage(options, background || '#ffffff') ?? Promise.resolve(null);
	}
</script>

<!--
	The view takes the keys that move it, as the canvas of the graph does,
	which no standard widget does: that is what the application role is for.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={container}
	class="absolute inset-0 touch-none overflow-hidden bg-background outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
	role="application"
	tabindex="0"
	aria-label={label}
	aria-describedby={describedby}
	aria-busy={drawing}
>
	<canvas bind:this={grid} class="absolute inset-0 h-full w-full" aria-hidden="true"></canvas>
	<div bind:this={content} class="absolute top-0 left-0" data-diagram>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- Mermaid's SVG, which it sanitises in its strict mode. -->
		{@html svg ?? ''}
	</div>
</div>

{#if text === null}
	<p
		class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground"
	>
		This file is too large to draw as a diagram.
	</p>
{:else if drawing && svg === null}
	<p
		class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
		role="status"
	>
		<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
		Drawing the diagram…
	</p>
{/if}
