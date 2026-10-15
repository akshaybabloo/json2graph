import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import type {
	EngineEvent,
	ExportOptions,
	FromWorker,
	GraphStats,
	LoadEvent,
	ToWorker
} from './protocol';
import type { Settings } from '../settings.svelte';
import { readTheme } from './theme';

/** Space kept around the graph when it is fitted to the canvas. */
const MARGIN = 48;
/** Below this scale the text is too small to read. */
const READABLE_SCALE = 0.5;
const MAX_SCALE = 4;
/** How much one press of a zoom button or key magnifies. */
export const ZOOM_STEP = 1.4;
/** How far one press of an arrow key moves the graph, in pixels. */
const PAN_STEP = 80;

/** Where the graph is panned and zoomed to: its offset on the canvas, and its scale. */
export type View = { x: number; y: number; k: number };

/**
 * Page-side half of the graph view: hands the canvas to the worker, and keeps
 * it informed of the canvas size, the theme, the pan/zoom transform and the
 * pointer.
 */
export class GraphController {
	#canvas: HTMLCanvasElement;
	#worker: Worker;
	#zoom: ZoomBehavior<HTMLCanvasElement, unknown>;
	#stats: GraphStats | null = null;
	#load = 0;
	#keepView = false;
	/** The view to show the graph being loaded in, rather than the starting one. */
	#restoreView: View | null = null;
	/** Exports waiting for their image, by request id. */
	#exports = new Map<number, (blob: Blob | null) => void>();
	#exported = 0;
	#disconnect: () => void;

	constructor(canvas: HTMLCanvasElement, onEvent: (event: LoadEvent | EngineEvent) => void) {
		this.#canvas = canvas;
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
			const message = event.data;
			if (message.type === 'cursor') {
				canvas.style.cursor = message.expandable ? 'pointer' : '';
				return;
			}
			if (message.type === 'layout') {
				const { x, y, k, home, width, height, rootTop, rootHeight } = message;
				if (!this.#stats) return;
				this.#stats = { ...this.#stats, width, height, rootTop, rootHeight };
				if (home) {
					this.home();
				} else {
					this.#limitZoom(this.#fitScale(this.#stats));
					this.#setView(x, y, k);
				}
				return;
			}
			if (message.type === 'image') {
				this.#exports.get(message.id)?.(message.blob);
				this.#exports.delete(message.id);
				return;
			}
			if (message.type === 'engine') {
				onEvent(message);
				return;
			}
			// Ignore anything from a load that has since been replaced.
			if (message.id !== this.#load) return;
			if (message.type === 'ready') {
				this.#stats = message.stats;
				if (this.#restoreView) {
					const { x, y, k } = this.#restoreView;
					this.#limitZoom(this.#fitScale(message.stats));
					this.#setView(x, y, k);
				} else if (!this.#keepView) {
					this.home();
				}
			}
			onEvent(message);
		});

		const offscreen = canvas.transferControlToOffscreen();
		this.#post(
			{
				type: 'init',
				canvas: offscreen,
				width: canvas.clientWidth,
				height: canvas.clientHeight,
				dpr: devicePixelRatio,
				theme: readTheme(canvas),
				motion: !matchMedia('(prefers-reduced-motion: reduce)').matches
			},
			[offscreen]
		);

		// The theme is switched by toggling a class on the root element.
		const themeObserver = new MutationObserver(() => {
			this.#post({ type: 'theme', theme: readTheme(canvas) });
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'style']
		});

		const sizeObserver = new ResizeObserver(() => {
			this.#post({
				type: 'resize',
				width: canvas.clientWidth,
				height: canvas.clientHeight,
				dpr: devicePixelRatio
			});
		});
		sizeObserver.observe(canvas);

		this.#zoom = zoom<HTMLCanvasElement, unknown>().on(
			'zoom',
			(event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				const { x, y, k } = event.transform;
				this.#post({ type: 'view', x, y, k });
			}
		);
		// A click expands a value, so a double click must not also zoom.
		select(canvas).call(this.#zoom).on('dblclick.zoom', null);

		// d3-zoom swallows the click that ends a drag, so these are real clicks.
		const onClick = (event: MouseEvent) => {
			this.#post({ type: 'click', x: event.offsetX, y: event.offsetY });
		};
		const onMove = (event: PointerEvent) => {
			this.#post({ type: 'hover', x: event.offsetX, y: event.offsetY });
		};
		const onLeave = () => this.#post({ type: 'leave' });
		// The view can be moved without a pointer, once the canvas has focus.
		const onKey = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP;
			switch (event.key) {
				case 'ArrowLeft':
					this.#panBy(step, 0);
					break;
				case 'ArrowRight':
					this.#panBy(-step, 0);
					break;
				case 'ArrowUp':
					this.#panBy(0, step);
					break;
				case 'ArrowDown':
					this.#panBy(0, -step);
					break;
				case '+':
				case '=':
					this.zoomBy(ZOOM_STEP);
					break;
				case '-':
				case '_':
					this.zoomBy(1 / ZOOM_STEP);
					break;
				case '0':
					this.fit();
					break;
				default:
					return;
			}
			event.preventDefault();
		};
		canvas.addEventListener('click', onClick);
		canvas.addEventListener('pointermove', onMove);
		canvas.addEventListener('pointerleave', onLeave);
		canvas.addEventListener('keydown', onKey);

		this.#disconnect = () => {
			themeObserver.disconnect();
			sizeObserver.disconnect();
			select(canvas).on('.zoom', null);
			canvas.removeEventListener('click', onClick);
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerleave', onLeave);
			canvas.removeEventListener('keydown', onKey);
		};
	}

	/**
	 * Replaces the graph of `tab`, which is on screen, with the document in
	 * `data`, of the type `format` (JSON unless said). With `keepView` the pan
	 * and zoom are left alone, which suits edits to the same document, and with
	 * `view` the graph is shown as it was when that view was taken.
	 */
	load(
		tab: number,
		data: Blob,
		{
			format = 'json',
			keepView = false,
			view = null
		}: { format?: string; keepView?: boolean; view?: View | null } = {}
	) {
		// With no graph on screen there is no view to keep: the first one gets
		// the starting view, like any newly opened document.
		this.#keepView = keepView && this.#stats !== null;
		this.#restoreView = view;
		this.#load += 1;
		this.#post({ type: 'load', id: this.#load, tab, data, format });
	}

	/**
	 * Shows the graph `tab` kept, in `view`, and abandons any load in progress.
	 * Nothing is shown when the tab kept none: it needs a load.
	 */
	show(tab: number, view: View | null) {
		this.#stats = null;
		this.#keepView = false;
		this.#restoreView = view;
		this.#load += 1;
		this.#canvas.style.cursor = '';
		this.#post({ type: 'show', id: this.#load, tab });
	}

	/** Removes the graph of `tab`, which is on screen, abandoning any load still in progress. */
	clear(tab: number) {
		this.#stats = null;
		this.#load += 1;
		this.#canvas.style.cursor = '';
		this.#post({ type: 'clear', id: this.#load, tab });
	}

	/** Frees the graph of `tab`, which is not on screen. */
	discard(tab: number) {
		this.#post({ type: 'discard', tab });
	}

	/** Where the graph is panned and zoomed to, when there is one. */
	get view(): View | null {
		if (!this.#stats) return null;
		const { x, y, k } = zoomTransform(this.#canvas);
		return { x, y, k };
	}

	/** Zooms by `factor` around the centre of the canvas. */
	zoomBy(factor: number) {
		select(this.#canvas).call(this.#zoom.scaleBy, factor);
	}

	/**
	 * A PNG of the graph: all of it when that fits in a readable image,
	 * otherwise the part on screen. Null when there is no graph.
	 */
	exportImage(options: ExportOptions): Promise<Blob | null> {
		const id = ++this.#exported;
		return new Promise((resolve) => {
			this.#exports.set(id, resolve);
			this.#post({ type: 'export', id, options });
		});
	}

	/** Draws connections as `connections` says, and labels them with keys or not. */
	configure({ connections, connectionKeys }: Pick<Settings, 'connections' | 'connectionKeys'>) {
		this.#post({ type: 'settings', connections, connectionKeys });
	}

	/** Collapses every box into its row, leaving the root, or shows every box again. */
	collapseAll(collapsed: boolean) {
		this.#post({ type: 'collapse', collapsed });
	}

	/** Shows the whole graph. */
	fit() {
		const stats = this.#stats;
		if (!stats) return;
		const scale = this.#fitScale(stats);
		this.#limitZoom(scale);
		const k = Math.min(scale, 1);
		const { clientWidth, clientHeight } = this.#canvas;
		this.#setView((clientWidth - stats.width * k) / 2, (clientHeight - stats.height * k) / 2, k);
	}

	/**
	 * The starting view: the whole graph when it is readable at that size,
	 * otherwise the root box at full size.
	 */
	home() {
		const stats = this.#stats;
		if (!stats) return;
		const scale = this.#fitScale(stats);
		if (scale >= READABLE_SCALE) {
			this.fit();
			return;
		}
		this.#limitZoom(scale);
		const { clientHeight } = this.#canvas;
		const rootFits = stats.rootHeight + 2 * MARGIN <= clientHeight;
		const y = rootFits
			? clientHeight / 2 - (stats.rootTop + stats.rootHeight / 2)
			: MARGIN - stats.rootTop;
		this.#setView(MARGIN, y, 1);
	}

	destroy() {
		this.#disconnect();
		this.#worker.terminate();
	}

	/** The scale at which the whole graph fits the canvas. */
	#fitScale(stats: GraphStats): number {
		const { clientWidth, clientHeight } = this.#canvas;
		return Math.min(
			clientWidth / (stats.width + 2 * MARGIN),
			clientHeight / (stats.height + 2 * MARGIN)
		);
	}

	/** Lets the user zoom out until the whole graph is half the size of the canvas. */
	#limitZoom(fitScale: number) {
		this.#zoom.scaleExtent([Math.max(Math.min(fitScale, 1) / 2, 1e-9), MAX_SCALE]);
	}

	/** Moves the graph by a distance in screen pixels. */
	#panBy(dx: number, dy: number) {
		const { k } = zoomTransform(this.#canvas);
		select(this.#canvas).call(this.#zoom.translateBy, dx / k, dy / k);
	}

	#setView(x: number, y: number, k: number) {
		select(this.#canvas).call(this.#zoom.transform, zoomIdentity.translate(x, y).scale(k));
	}

	#post(message: ToWorker, transfer: Transferable[] = []) {
		this.#worker.postMessage(message, transfer);
	}
}
