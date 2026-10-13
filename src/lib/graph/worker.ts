/**
 * Graph worker: owns the document (inside the WebAssembly engine) and draws it
 * on an OffscreenCanvas. The page only sends the view transform, the canvas
 * size and the file to load.
 */
import init, { Document } from '#engine';
import { MONO_FONT } from '../fonts';
import type { ExportOptions, FromWorker, ToWorker } from './protocol';
import type { Theme } from './theme';

const FONT_SIZE = 12;
const ROW_HEIGHT = 20;
const PAD_X = 12;
const PAD_Y = 8;
const GAP_X = 72;
const GAP_Y = 20;
const RADIUS = 6;
const ARROW = 7;
const MAX_KEY_CHARS = 32;
const MAX_VALUE_CHARS = 48;
/** Rows are drawn as text only when the font is at least this tall on screen. */
const MIN_TEXT_PX = 5;
/** Bytes indexed between progress reports. */
const PARSE_CHUNK = 16 * 1024 * 1024;
/** Loads shorter than this report no progress, so quick edits do not flash a progress bar. */
const PROGRESS_DELAY = 100;
/**
 * While a document up to this size loads, the previous graph stays on screen
 * and survives a failed load. Above it the previous document is freed first,
 * because two large documents may not fit in memory.
 */
const RETAIN_LIMIT = 64 * 1024 * 1024;
const STRING_CACHE_LIMIT = 20_000;
/** An exported image is at most this many pixels on a side, */
const EXPORT_MAX_SIDE = 8192;
/** ... and shows the whole graph only if that leaves the text readable. */
const EXPORT_MIN_SCALE = 0.5;
const EXPORT_MARGIN = 24;
/** Distance between the fine lines of the background grid, in world pixels. */
const GRID_SIZE = 24;
/** Every this many fine lines there is a stronger one. */
const GRID_MAJOR = 5;
/** Fine lines closer together than this on screen are not drawn. */
const GRID_MIN_PX = 8;
/** How much of the graph is hidden while the path to the box under the pointer is shown. */
const FOCUS_VEIL = 0.75;
/**
 * The edges of that path are dashed, and the dashes run the way the edges
 * point: lengths in world pixels, speed in world pixels a second.
 */
const FLOW_DASH = 6;
const FLOW_GAP = 5;
const FLOW_SPEED = 36;

// Value kinds and key modes, as encoded by the engine (see crates/engine/src/query.rs).
const NONE = 0xffffffff;
const KIND_OBJECT = 5;
const KIND_ARRAY = 6;
const KEY_NONE = 0;
const KEY_INDEX = 1;
const LABEL_NAME = 1;
const LABEL_INDEX = 2;
const ROW_WORDS = 8;
const ROW_WRAPPED = 1 << 16;
const ROW_CONTINUED = 1 << 17;
const ROW_MORE = 1 << 18;
const ROW_FIRST = 1 << 19;

let memory: WebAssembly.Memory;
const engine = init().then((wasm) => {
	memory = wasm.memory;
});
engine.then(
	() => post({ type: 'engine', error: null }),
	(error) => post({ type: 'engine', error: describe(error) })
);

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let size = { width: 0, height: 0, dpr: 1 };
let view = { x: 0, y: 0, k: 1 };
let theme: Theme;
let doc: Document | null = null;
let sourcePtr = 0;
let currentLoad = 0;
let scheduled = false;
/** Whether the last `cursor` message said the pointer was over an expandable value. */
let hovering = false;
/** Where the pointer is over the canvas, in CSS pixels. */
let pointer: { x: number; y: number } | null = null;
/** The box that was under the pointer when the last frame was drawn, or `NONE`. */
let focus = NONE;
/** Whether the graph may be animated. */
let motion = true;

const decoder = new TextDecoder();
/** Decoded keys and values of recently drawn rows, by byte offset. */
const strings = new Map<number, string>();
let valueX = new Float32Array(1024);

function post(message: FromWorker) {
	postMessage(message);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

addEventListener('message', (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			ctx = message.canvas.getContext('2d', { alpha: false });
			theme = message.theme;
			motion = message.motion;
			resize(message.width, message.height, message.dpr);
			break;
		case 'resize':
			resize(message.width, message.height, message.dpr);
			break;
		case 'theme':
			theme = message.theme;
			requestDraw();
			break;
		case 'view':
			view = { x: message.x, y: message.y, k: message.k };
			requestDraw();
			break;
		case 'load':
			load(message.id, message.data);
			break;
		case 'clear':
			currentLoad = message.id;
			show(null);
			break;
		case 'click':
			click(message.x, message.y);
			break;
		case 'hover':
			hover(message.x, message.y);
			break;
		case 'leave':
			pointer = null;
			if (focus !== NONE) requestDraw();
			break;
		case 'export':
			exportImage(message.id, message.options);
			break;
	}
});

/** Whether rows are large enough on screen to be drawn as text, and so to be clicked. */
function textVisible(): boolean {
	return FONT_SIZE * view.k >= MIN_TEXT_PX;
}

/** Expands the value under the pointer onto wrapped lines, or collapses it again. */
function click(x: number, y: number) {
	if (!doc || !textVisible()) return;
	const moved = doc.toggle_at(view.x, view.y, view.k, x, y);
	if (Number.isNaN(moved)) return;
	strings.clear();
	// The boxes have been repositioned: keep the clicked row where it was.
	view = { ...view, y: view.y - moved * view.k };
	post({ type: 'layout', ...view, width: doc.width(), height: doc.height() });
	requestDraw();
}

function hover(x: number, y: number) {
	pointer = { x, y };
	if (focusAt() !== focus) requestDraw();
	const expandable =
		doc !== null && textVisible() && doc.expandable_at(view.x, view.y, view.k, x, y);
	if (expandable === hovering) return;
	hovering = expandable;
	post({ type: 'cursor', expandable });
}

/** The box under the pointer, or `NONE`. */
function focusAt(): number {
	return doc && pointer ? doc.box_at(view.x, view.y, view.k, pointer.x, pointer.y) : NONE;
}

function resize(width: number, height: number, dpr: number) {
	size = { width, height, dpr };
	if (!ctx) return;
	ctx.canvas.width = Math.max(1, Math.round(width * dpr));
	ctx.canvas.height = Math.max(1, Math.round(height * dpr));
	// Resizing clears the canvas, so repaint now rather than a frame later.
	draw();
}

function requestDraw() {
	if (scheduled) return;
	scheduled = true;
	requestAnimationFrame(draw);
}

async function load(id: number, data: Blob) {
	const started = performance.now();
	currentLoad = id;
	if (data.size > RETAIN_LIMIT) show(null);

	let next: Document | null = null;
	let lastReport = started + PROGRESS_DELAY - 50;
	const progress = (phase: 'reading' | 'parsing' | 'layout', fraction: number) => {
		const now = performance.now();
		if (now - lastReport < 50) return;
		lastReport = now;
		post({ type: 'progress', id, phase, fraction });
	};

	try {
		await engine;
		if (id !== currentLoad) return;
		next = new Document(data.size);

		// Copy the file into the engine's buffer chunk by chunk, so it never
		// exists as a JavaScript string.
		let offset = 0;
		const reader = data.stream().getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (id !== currentLoad) {
				void reader.cancel();
				next.free();
				return;
			}
			if (done) break;
			if (offset + value.length > data.size) throw new Error('The file changed while loading');
			new Uint8Array(memory.buffer, next.source_ptr() + offset, value.length).set(value);
			offset += value.length;
			progress('reading', offset / data.size);
		}
		if (offset !== data.size) throw new Error('The file could not be read completely');

		progress('parsing', 0);
		while (!next.parse(PARSE_CHUNK)) {
			progress('parsing', next.parsed_bytes() / data.size);
			// Yield so a newer load or a resize is not stuck behind this one.
			await new Promise((resolve) => setTimeout(resolve));
			if (id !== currentLoad) {
				next.free();
				return;
			}
		}

		progress('layout', 0);
		await new Promise((resolve) => setTimeout(resolve));
		if (id !== currentLoad) {
			next.free();
			return;
		}
		next.layout(
			charWidth(ctx, FONT_SIZE),
			ROW_HEIGHT,
			PAD_X,
			PAD_Y,
			GAP_X,
			GAP_Y,
			MAX_KEY_CHARS,
			MAX_VALUE_CHARS
		);
	} catch (error) {
		next?.free();
		if (id === currentLoad) {
			post({ type: 'error', id, message: describe(error) });
		}
		return;
	}

	show(next);
	post({
		type: 'ready',
		id,
		stats: {
			bytes: data.size,
			values: next.value_count(),
			boxes: next.box_count(),
			width: next.width(),
			height: next.height(),
			rootWidth: next.root_width(),
			rootTop: next.root_top(),
			rootHeight: next.root_height(),
			ms: performance.now() - started
		}
	});
	requestDraw();
}

/** Replaces the document on screen and frees the previous one. */
function show(next: Document | null) {
	doc?.free();
	doc = next;
	sourcePtr = next ? next.source_ptr() : 0;
	strings.clear();
	hovering = false;
	requestDraw();
}

/** Selects the font at the given size and returns the advance width of one character. */
function charWidth(ctx: OffscreenCanvasRenderingContext2D | null, fontPx: number): number {
	if (!ctx) return fontPx * 0.6;
	ctx.font = `${fontPx}px ${MONO_FONT}`;
	return ctx.measureText('0'.repeat(32)).width / 32;
}

function draw() {
	scheduled = false;
	if (!ctx) return;
	// Found again for every frame: the view can move under a still pointer.
	focus = focusAt();
	render(ctx, size.width, size.height, size.dpr, view, {
		background: theme.background,
		grid: true,
		focus
	});
	// The path in focus is animated, so it needs a frame after this one.
	if (focus !== NONE && motion) requestDraw();
}

/** What a frame shows besides the graph itself. */
interface Scene {
	/** A CSS colour. */
	background: string;
	grid: boolean;
	/** The box whose path from the root stands out from a dimmed graph, or `NONE`. */
	focus: number;
}

/**
 * Renders the graph as a PNG: all of it when it fits in an image that is
 * still readable, otherwise what is on screen, at twice the resolution.
 */
async function exportImage(id: number, options: ExportOptions) {
	if (!doc) {
		post({ type: 'image', id, blob: null });
		return;
	}
	const width = doc.width() + 2 * EXPORT_MARGIN;
	const height = doc.height() + 2 * EXPORT_MARGIN;
	const scale = Math.min(2, EXPORT_MAX_SIDE / width, EXPORT_MAX_SIDE / height);
	const whole = scale >= EXPORT_MIN_SCALE;
	const canvas = whole
		? new OffscreenCanvas(Math.ceil(width * scale), Math.ceil(height * scale))
		: new OffscreenCanvas(Math.max(1, size.width * 2), Math.max(1, size.height * 2));
	const target = canvas.getContext('2d')!;
	const scene = {
		background: options.background ?? theme.background,
		grid: options.grid,
		focus: NONE
	};
	if (whole) {
		const offset = EXPORT_MARGIN * scale;
		render(target, canvas.width, canvas.height, 1, { x: offset, y: offset, k: scale }, scene);
	} else {
		render(target, size.width, size.height, 2, view, scene);
	}
	post({ type: 'image', id, blob: await canvas.convertToBlob({ type: 'image/png' }) });
}

/** Draws `scene` under `view` on a canvas `width` x `height` CSS pixels in size. */
function render(
	ctx: OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	dpr: number,
	view: { x: number; y: number; k: number },
	scene: Scene
) {
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	// A transparent background fills nothing, which leaves the new canvas of
	// an export clear.
	ctx.fillStyle = scene.background;
	ctx.fillRect(0, 0, width, height);
	if (scene.grid) drawGrid(ctx, width, height, view);
	if (!doc) return;

	const k = view.k;
	const text = FONT_SIZE * k >= MIN_TEXT_PX;
	doc.query(view.x, view.y, k, width, height, text);
	drawFrame(ctx, k, text, false);
	if (scene.focus === NONE) return;

	// The graph fades behind a veil of the background, and the path to the
	// box in focus is drawn again over it.
	ctx.fillStyle = scene.background;
	ctx.globalAlpha = FOCUS_VEIL;
	ctx.fillRect(0, 0, width, height);
	ctx.globalAlpha = 1;
	doc.query_path(scene.focus, view.x, view.y, k, width, height, text);
	drawFrame(ctx, k, text, true);
}

/**
 * Draws what the last query of the engine found, at scale `k`. With `strong`
 * its edges and outlines are darker, for the path that stands out.
 */
function drawFrame(
	ctx: OffscreenCanvasRenderingContext2D,
	k: number,
	text: boolean,
	strong: boolean
) {
	if (!doc) return;
	// Views are created after the query: when WebAssembly memory grows, views
	// created earlier are detached.
	const buffer = memory.buffer;
	const edges = new Float32Array(buffer, doc.edges_ptr(), doc.edges_len());
	const farEdges = new Float32Array(buffer, doc.far_edges_ptr(), doc.far_edges_len());
	const slivers = new Float32Array(buffer, doc.slivers_ptr(), doc.slivers_len());
	const boxes = new Float32Array(buffer, doc.boxes_ptr(), doc.boxes_len());
	const edgeColour = strong ? theme.key : theme.edge;

	// Edges stop at the base of their arrowhead. The sampled edges to
	// off-screen children are drawn faintly and without one.
	const arrow = ARROW * k >= 3 ? ARROW * k : 0;
	ctx.strokeStyle = edgeColour;
	ctx.lineWidth = Math.min(Math.max(k * 1.25, 0.6), 2.5);
	ctx.globalAlpha = 0.25;
	strokeEdges(ctx, farEdges, 0);
	ctx.globalAlpha = 1;
	if (strong && motion) {
		// Never so small that the dashes run together.
		const scale = Math.max(k, 0.5);
		const period = (FLOW_DASH + FLOW_GAP) * scale;
		ctx.setLineDash([FLOW_DASH * scale, FLOW_GAP * scale]);
		// A falling offset moves the dashes from the start of an edge to its end.
		ctx.lineDashOffset = -(((performance.now() / 1000) * FLOW_SPEED * scale) % period);
	}
	strokeEdges(ctx, edges, arrow);
	ctx.setLineDash([]);

	if (arrow) {
		const half = arrow * 0.45;
		ctx.beginPath();
		for (let i = 0; i < edges.length; i += 4) {
			const tip = edges[i + 2];
			const y = edges[i + 3];
			ctx.moveTo(tip - arrow, y - half);
			ctx.lineTo(tip, y);
			ctx.lineTo(tip - arrow, y + half);
			ctx.closePath();
		}
		ctx.fillStyle = edgeColour;
		ctx.fill();
	}

	ctx.beginPath();
	for (let i = 0; i < slivers.length; i += 4) {
		ctx.rect(slivers[i], slivers[i + 1], slivers[i + 2], slivers[i + 3]);
	}
	ctx.fillStyle = theme.edge;
	ctx.globalAlpha = 0.5;
	ctx.fill();
	ctx.globalAlpha = 1;

	const radius = RADIUS * k;
	ctx.beginPath();
	for (let i = 0; i < boxes.length; i += 4) {
		const h = boxes[i + 3];
		if (radius >= 1.5) {
			ctx.roundRect(boxes[i], boxes[i + 1], boxes[i + 2], h, Math.min(radius, h / 2));
		} else {
			ctx.rect(boxes[i], boxes[i + 1], boxes[i + 2], h);
		}
	}
	ctx.fillStyle = theme.box;
	ctx.fill();
	if (text) {
		ctx.strokeStyle = strong ? theme.edge : theme.border;
		ctx.lineWidth = Math.min(Math.max(k, 0.5), 1.5);
		ctx.stroke();
		drawRows(ctx, buffer, FONT_SIZE * k);
	} else {
		// Too small to read: a faint outline would disappear, so boxes become
		// solid blocks that show the shape of the graph.
		ctx.fillStyle = edgeColour;
		ctx.globalAlpha = strong ? 0.8 : 0.35;
		ctx.fill();
		ctx.globalAlpha = 1;
	}
}

/**
 * Opacity of grid lines that are `spacing` pixels apart on screen. It rises
 * with the spacing and is continuous where one level of the grid takes over
 * from the next, so lines fade in and out as the view zooms instead of popping.
 */
function gridAlpha(spacing: number): number {
	const major = GRID_MIN_PX * GRID_MAJOR;
	const alpha =
		spacing < major
			? (0.5 * (spacing - GRID_MIN_PX)) / (major - GRID_MIN_PX)
			: 0.5 + (0.5 * (spacing - major)) / (major * (GRID_MAJOR - 1));
	return Math.min(Math.max(alpha, 0), 1);
}

/**
 * A blueprint grid behind the graph: fine lines with a stronger line every
 * `GRID_MAJOR`th. It moves and scales with the view; as the view zooms out
 * the fine lines fade away and the stronger ones become the fine lines of a
 * grid `GRID_MAJOR` times coarser.
 */
function drawGrid(
	ctx: OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	view: { x: number; y: number; k: number }
) {
	let step = GRID_SIZE * view.k;
	if (!(step > 0) || !Number.isFinite(step)) return;
	while (step < GRID_MIN_PX) step *= GRID_MAJOR;

	ctx.strokeStyle = theme.grid;
	ctx.lineWidth = 1;
	for (const major of [false, true]) {
		const spacing = major ? step * GRID_MAJOR : step;
		ctx.beginPath();
		// Lines are numbered from the world origin; every `GRID_MAJOR`th fine
		// line is left for the pass that draws the stronger ones.
		for (let n = Math.ceil(-view.x / spacing); n * spacing + view.x <= width; n++) {
			if (!major && n % GRID_MAJOR === 0) continue;
			const x = Math.round(n * spacing + view.x) + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		for (let n = Math.ceil(-view.y / spacing); n * spacing + view.y <= height; n++) {
			if (!major && n % GRID_MAJOR === 0) continue;
			const y = Math.round(n * spacing + view.y) + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
		}
		ctx.globalAlpha = gridAlpha(spacing);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}

/** Strokes `x1, y1, x2, y2` edges as one path of curves that stop `inset` pixels short. */
function strokeEdges(ctx: OffscreenCanvasRenderingContext2D, edges: Float32Array, inset: number) {
	ctx.beginPath();
	for (let i = 0; i < edges.length; i += 4) {
		const x1 = edges[i];
		const y1 = edges[i + 1];
		const x2 = edges[i + 2] - inset;
		const y2 = edges[i + 3];
		const mid = (x1 + x2) / 2;
		ctx.moveTo(x1, y1);
		ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
	}
	ctx.stroke();
}

function drawRows(ctx: OffscreenCanvasRenderingContext2D, buffer: ArrayBuffer, fontPx: number) {
	const length = doc!.rows_len();
	const words = new Uint32Array(buffer, doc!.rows_ptr(), length);
	const floats = new Float32Array(buffer, doc!.rows_ptr(), length);
	const count = length / ROW_WORDS;
	if (valueX.length < count) valueX = new Float32Array(count * 2);
	const labels = new Uint32Array(buffer, doc!.labels_ptr(), doc!.labels_len());

	// A line between rows, so each row is a cell that an edge visibly leaves.
	// The wrapped lines of an expanded value stay together in one cell.
	const k = fontPx / FONT_SIZE;
	const pad = PAD_X * k;
	const half = (ROW_HEIGHT * k) / 2;
	ctx.beginPath();
	for (let i = 0; i < length; i += ROW_WORDS) {
		if (words[i + 3] & (ROW_FIRST | ROW_CONTINUED)) continue;
		const y = floats[i + 1] - half;
		ctx.moveTo(floats[i] - pad, y);
		ctx.lineTo(floats[i + 2] + pad, y);
	}
	ctx.strokeStyle = theme.border;
	ctx.lineWidth = Math.min(Math.max(k, 0.5), 1);
	ctx.stroke();

	const charW = charWidth(ctx, fontPx);
	ctx.textBaseline = 'middle';

	// Keys first, then values, so the fill colour rarely changes.
	ctx.fillStyle = theme.key;
	for (let row = 0, i = 0; row < count; row++, i += ROW_WORDS) {
		const x = floats[i];
		const flags = words[i + 3];
		const keyMode = (flags >> 8) & 0xff;
		if (keyMode === KEY_NONE) {
			valueX[row] = x;
			continue;
		}
		const key =
			keyMode === KEY_INDEX
				? `${arrayPrefix(labels, words[i + 5])}[${words[i + 4]}]`
				: sourceText(words[i + 4], words[i + 5], MAX_KEY_CHARS);
		// The later lines of an expanded value line up under its first line.
		if (!(flags & ROW_CONTINUED)) ctx.fillText(key + ':', x, floats[i + 1], floats[i + 2] - x);
		valueX[row] = x + (key.length + 2) * charW;
	}

	let colour = '';
	for (let row = 0, i = 0; row < count; row++, i += ROW_WORDS) {
		const x = valueX[row];
		const room = floats[i + 2] - x;
		if (room <= 1) continue;
		const flags = words[i + 3];
		const kind = flags & 0xff;
		let value: string;
		if (kind === KIND_OBJECT) value = words[i + 6] ? `{${words[i + 6]}}` : '{}';
		else if (kind === KIND_ARRAY) value = words[i + 6] ? `[${words[i + 6]}]` : '[]';
		else if (flags & ROW_WRAPPED) value = sourceText(words[i + 6], words[i + 7], Infinity);
		else value = sourceText(words[i + 6], words[i + 7], MAX_VALUE_CHARS);
		if (flags & ROW_MORE) value += '…';

		const next = theme[VALUE_COLOURS[kind]];
		if (next !== colour) ctx.fillStyle = colour = next;
		ctx.fillText(value, x, floats[i + 1], room);
	}
}

/** Theme colour of a value, by kind. */
const VALUE_COLOURS = [
	'null',
	'boolean',
	'boolean',
	'number',
	'string',
	'container',
	'container'
] as const;

/**
 * What precedes the `[index]` in the keys of an array's rows, from the label
 * at `at` (see `Frame::labels` in the engine): the name of the property that
 * holds the array, or the array's own index when it is inside another array.
 */
function arrayPrefix(labels: Uint32Array, at: number): string {
	const kind = labels[at];
	if (kind === LABEL_NAME) return sourceText(labels[at + 1], labels[at + 2], MAX_KEY_CHARS);
	return kind === LABEL_INDEX ? String(labels[at + 1]) : '';
}

const ESCAPE = /\\(?:u([0-9a-fA-F]{4})|.)/g;

/**
 * The source text at a byte range, shortened to `limit` characters. JSON
 * escapes are shown as written, except `\uXXXX`, which is decoded.
 */
function sourceText(offset: number, length: number, limit: number): string {
	let text = strings.get(offset);
	if (text !== undefined) return text;

	const bytes = Math.min(length, limit * 3);
	text = decoder.decode(new Uint8Array(memory.buffer, sourcePtr + offset, bytes));
	if (text.includes('\\u')) {
		text = text.replace(ESCAPE, (match, hex?: string) => {
			const code = hex ? parseInt(hex, 16) : 0;
			return code >= 0x20 ? String.fromCharCode(code) : match;
		});
	}
	if (bytes < length || text.length > limit) {
		// Drop a character that the cut left incomplete.
		text = text.slice(0, limit - 1).replace(/[\uD800-\uDBFF�]$/, '') + '…';
	}

	if (strings.size >= STRING_CACHE_LIMIT) strings.clear();
	strings.set(offset, text);
	return text;
}
