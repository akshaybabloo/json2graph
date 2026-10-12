/** Messages between the page and the graph worker. */

import type { Theme } from './theme';

export interface GraphStats {
	/** Size of the source document in bytes. */
	bytes: number;
	/** Number of JSON values. */
	values: number;
	/** Number of boxes (non-empty objects and arrays). */
	boxes: number;
	/** Size of the laid-out graph, in world pixels. */
	width: number;
	height: number;
	/** The root box, whose left edge is at x = 0. */
	rootWidth: number;
	rootTop: number;
	rootHeight: number;
	/** Time from the start of the load until the graph was ready. */
	ms: number;
}

export type ToWorker =
	| {
			type: 'init';
			canvas: OffscreenCanvas;
			width: number;
			height: number;
			dpr: number;
			theme: Theme;
	  }
	| { type: 'resize'; width: number; height: number; dpr: number }
	| { type: 'theme'; theme: Theme }
	/** Screen = world * k + (x, y). */
	| { type: 'view'; x: number; y: number; k: number }
	| { type: 'load'; id: number; data: Blob }
	/** Removes the graph. Like a load, it supersedes any load with an older `id`. */
	| { type: 'clear'; id: number }
	/** Pointer events, in CSS pixels from the top left of the canvas. */
	| { type: 'click'; x: number; y: number }
	| { type: 'hover'; x: number; y: number }
	| { type: 'export'; id: number };

/** Progress and outcome of the load with the same `id`. */
export type LoadEvent =
	| { type: 'progress'; id: number; phase: 'reading' | 'parsing' | 'layout'; fraction: number }
	| { type: 'ready'; id: number; stats: GraphStats }
	| { type: 'error'; id: number; message: string };

export type FromWorker =
	| LoadEvent
	/**
	 * A value was expanded or collapsed: the graph has a new size, and the view
	 * has moved so that the clicked row stays where it was on screen.
	 */
	| { type: 'layout'; x: number; y: number; k: number; width: number; height: number }
	/** Whether the pointer is over a value that a click expands or collapses. */
	| { type: 'cursor'; expandable: boolean }
	/** The PNG asked for by the `export` with the same `id`; null when there is no graph. */
	| { type: 'image'; id: number; blob: Blob | null };
