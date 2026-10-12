import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import type { FromWorker, GraphStats, LoadEvent, ToWorker } from './protocol';
import { readTheme } from './theme';

/** Space kept around the graph when it is fitted to the canvas. */
const MARGIN = 48;
/** Below this scale the text is too small to read. */
const READABLE_SCALE = 0.5;
const MAX_SCALE = 4;

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
	/** Exports waiting for their image, by request id. */
	#exports = new Map<number, (blob: Blob | null) => void>();
	#exported = 0;
	#disconnect: () => void;

	constructor(canvas: HTMLCanvasElement, onEvent: (event: LoadEvent) => void) {
		this.#canvas = canvas;
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
			const message = event.data;
			if (message.type === 'cursor') {
				canvas.style.cursor = message.expandable ? 'pointer' : '';
				return;
			}
			if (message.type === 'layout') {
				const { x, y, k, width, height } = message;
				if (this.#stats) this.#stats = { ...this.#stats, width, height };
				this.#setView(x, y, k);
				return;
			}
			if (message.type === 'image') {
				this.#exports.get(message.id)?.(message.blob);
				this.#exports.delete(message.id);
				return;
			}
			// Ignore anything from a load that has since been replaced.
			if (message.id !== this.#load) return;
			if (message.type === 'ready') {
				this.#stats = message.stats;
				if (!this.#keepView) this.home();
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
				theme: readTheme(canvas)
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
		canvas.addEventListener('click', onClick);
		canvas.addEventListener('pointermove', onMove);

		this.#disconnect = () => {
			themeObserver.disconnect();
			sizeObserver.disconnect();
			select(canvas).on('.zoom', null);
			canvas.removeEventListener('click', onClick);
			canvas.removeEventListener('pointermove', onMove);
		};
	}

	/**
	 * Replaces the current graph with the JSON in `data`. With `keepView` the
	 * pan and zoom are left alone, which suits edits to the same document.
	 */
	load(data: Blob, { keepView = false } = {}) {
		this.#keepView = keepView;
		this.#load += 1;
		this.#post({ type: 'load', id: this.#load, data });
	}

	/** Removes the graph, abandoning any load still in progress. */
	clear() {
		this.#stats = null;
		this.#load += 1;
		this.#canvas.style.cursor = '';
		this.#post({ type: 'clear', id: this.#load });
	}

	/** Zooms by `factor` around the centre of the canvas. */
	zoomBy(factor: number) {
		select(this.#canvas).call(this.#zoom.scaleBy, factor);
	}

	/**
	 * A PNG of the graph: all of it when that fits in a readable image,
	 * otherwise the part on screen. Null when there is no graph.
	 */
	exportImage(): Promise<Blob | null> {
		const id = ++this.#exported;
		return new Promise((resolve) => {
			this.#exports.set(id, resolve);
			this.#post({ type: 'export', id });
		});
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

	#setView(x: number, y: number, k: number) {
		select(this.#canvas).call(this.#zoom.transform, zoomIdentity.translate(x, y).scale(k));
	}

	#post(message: ToWorker, transfer: Transferable[] = []) {
		this.#worker.postMessage(message, transfer);
	}
}
