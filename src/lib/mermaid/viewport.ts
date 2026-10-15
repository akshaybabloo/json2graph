import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom';
import { ZOOM_STEP } from '../graph/controller';
import { drawGrid } from '../graph/grid';
import type { ExportOptions } from '../graph/protocol';

/** Space kept around the diagram when it is fitted to the view. */
const MARGIN = 48;
const MAX_SCALE = 4;
/** How far one press of an arrow key moves the diagram, in pixels. */
const PAN_STEP = 80;
/** An exported image is at most this many pixels on a side, */
const EXPORT_MAX_SIDE = 8192;
/** ... drawn at twice the size of the diagram when that fits. */
const EXPORT_SCALE = 2;
const EXPORT_MARGIN = 24;

/**
 * Pans and zooms a diagram drawn as SVG in `container`, as the graph is: by
 * dragging, scrolling, or the keys once it has focus. `content` holds the
 * SVG, and is moved and scaled from its top left corner, over the grid the
 * graph has, which `grid` draws.
 */
export class DiagramViewport {
	#container: HTMLElement;
	#content: HTMLElement;
	#grid: HTMLCanvasElement;
	#zoom: ZoomBehavior<HTMLElement, unknown>;
	/** The size of the diagram, unscaled, once there is one. */
	#size: { width: number; height: number } | null = null;
	#disconnect: () => void;

	constructor(container: HTMLElement, content: HTMLElement, grid: HTMLCanvasElement) {
		this.#container = container;
		this.#content = content;
		this.#grid = grid;
		content.style.transformOrigin = '0 0';
		this.#zoom = zoom<HTMLElement, unknown>().on('zoom', ({ transform }) => {
			content.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
			this.drawGrid();
		});
		select(container).call(this.#zoom).on('dblclick.zoom', null);

		const onKey = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP;
			const moves: Record<string, () => void> = {
				ArrowLeft: () => this.#panBy(step, 0),
				ArrowRight: () => this.#panBy(-step, 0),
				ArrowUp: () => this.#panBy(0, step),
				ArrowDown: () => this.#panBy(0, -step),
				'+': () => this.zoomBy(ZOOM_STEP),
				'=': () => this.zoomBy(ZOOM_STEP),
				'-': () => this.zoomBy(1 / ZOOM_STEP),
				_: () => this.zoomBy(1 / ZOOM_STEP),
				'0': () => this.fit()
			};
			const move = moves[event.key];
			if (!move) return;
			event.preventDefault();
			move();
		};
		container.addEventListener('keydown', onKey);
		const sizeObserver = new ResizeObserver(() => this.drawGrid());
		sizeObserver.observe(container);
		this.#disconnect = () => {
			select(container).on('.zoom', null);
			container.removeEventListener('keydown', onKey);
			sizeObserver.disconnect();
		};
	}

	/** Draws the grid for the view as it is, in the colours of the theme in effect. */
	drawGrid() {
		const { clientWidth: width, clientHeight: height } = this.#container;
		const dpr = devicePixelRatio;
		const canvas = this.#grid;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const context = canvas.getContext('2d');
		if (!context) return;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		const { x, y, k } = zoomTransform(this.#container);
		drawGrid(context, width, height, { x, y, k }, this.#gridColour());
	}

	#gridColour(): string {
		return getComputedStyle(this.#container).getPropertyValue('--graph-grid').trim() || '#cdd5e1';
	}

	/** The SVG of the diagram, sized as it was drawn, or none. */
	get #svg(): SVGSVGElement | null {
		return this.#content.querySelector('svg');
	}

	/**
	 * Takes the SVG now in `content` at the size it was drawn, and shows all of
	 * it unless `keepView`.
	 */
	update(keepView: boolean) {
		const svg = this.#svg;
		if (!svg) {
			this.#size = null;
			return;
		}
		// Mermaid draws to fit the width of its page; here it keeps its own size.
		const { width, height } = svg.viewBox.baseVal;
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.style.maxWidth = 'none';
		this.#size = { width, height };
		this.#limitZoom();
		if (!keepView) this.fit();
	}

	zoomBy(factor: number) {
		select(this.#container).call(this.#zoom.scaleBy, factor);
	}

	/** Shows the whole diagram, no larger than it was drawn. */
	fit() {
		if (!this.#size) return;
		const k = Math.min(this.#fitScale(), 1);
		const { clientWidth, clientHeight } = this.#container;
		const x = (clientWidth - this.#size.width * k) / 2;
		const y = (clientHeight - this.#size.height * k) / 2;
		select(this.#container).call(this.#zoom.transform, zoomIdentity.translate(x, y).scale(k));
	}

	/**
	 * A PNG of the whole diagram over `options.background`, or over `background`
	 * when that is not given. Null when there is no diagram.
	 */
	async exportImage(options: ExportOptions, background: string): Promise<Blob | null> {
		const svg = this.#svg;
		if (!svg || !this.#size) return null;
		const { width, height } = this.#size;
		const scale = Math.min(
			EXPORT_SCALE,
			(EXPORT_MAX_SIDE - 2 * EXPORT_MARGIN) / Math.max(width, height)
		);
		// From a `data:` URL: drawn from a blob instead, the HTML in the labels
		// would keep the canvas from being exported in Chrome and Safari.
		const image = new Image();
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
			new XMLSerializer().serializeToString(svg)
		)}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = Math.ceil(width * scale + 2 * EXPORT_MARGIN);
		canvas.height = Math.ceil(height * scale + 2 * EXPORT_MARGIN);
		const context = canvas.getContext('2d')!;
		const fill = options.background ?? background;
		if (fill !== 'transparent') {
			context.fillStyle = fill;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		if (options.grid) {
			const view = { x: EXPORT_MARGIN, y: EXPORT_MARGIN, k: scale };
			drawGrid(context, canvas.width, canvas.height, view, this.#gridColour());
		}
		context.drawImage(image, EXPORT_MARGIN, EXPORT_MARGIN, width * scale, height * scale);
		return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
	}

	destroy() {
		this.#disconnect();
	}

	/** The scale at which the whole diagram fits the view. */
	#fitScale(): number {
		if (!this.#size) return 1;
		const { clientWidth, clientHeight } = this.#container;
		return Math.min(
			clientWidth / (this.#size.width + 2 * MARGIN),
			clientHeight / (this.#size.height + 2 * MARGIN)
		);
	}

	/** Lets the diagram be zoomed out until it is half the size of the view. */
	#limitZoom() {
		this.#zoom.scaleExtent([Math.max(Math.min(this.#fitScale(), 1) / 2, 1e-9), MAX_SCALE]);
	}

	#panBy(dx: number, dy: number) {
		const { k } = zoomTransform(this.#container);
		select(this.#container).call(this.#zoom.translateBy, dx / k, dy / k);
	}
}
