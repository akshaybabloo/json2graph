/** Messages between the page and the graph worker. */

import type { Connections } from '../settings.svelte';
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

/** What an exported image shows behind the graph. */
export interface ExportOptions {
	/** A CSS colour, `transparent` for none; the background on screen when left out. */
	background?: string;
	/** Whether the grid is drawn. */
	grid: boolean;
}

export type ToWorker =
	| {
			type: 'init';
			canvas: OffscreenCanvas;
			width: number;
			height: number;
			dpr: number;
			theme: Theme;
			/** Whether the graph may move by itself: false when the user asks for reduced motion. */
			motion: boolean;
	  }
	| { type: 'resize'; width: number; height: number; dpr: number }
	| { type: 'theme'; theme: Theme }
	/**
	 * How connections are drawn, whether they are labelled with the keys of
	 * the nodes they lead to, and whether a click on a row leads to the source.
	 */
	| { type: 'settings'; connections: Connections; connectionKeys: boolean; linkCode: boolean }
	/** Screen = world * k + (x, y). */
	| { type: 'view'; x: number; y: number; k: number }
	/**
	 * Indexes `data` as the document of `tab`, in place of the one it had, and
	 * shows it. `format` is the id of the document's type: JSON, CSV or YAML.
	 */
	| { type: 'load'; id: number; tab: number; data: Blob; format: string }
	/**
	 * Shows the document `tab` kept, or nothing if it has none. Like a load, it
	 * supersedes any load with an older `id`.
	 */
	| { type: 'show'; id: number; tab: number }
	/** Removes the graph of `tab`, which is on screen. It supersedes older loads too. */
	| { type: 'clear'; id: number; tab: number }
	/** Frees the document `tab` kept, which is not on screen; showing it again takes a load. */
	| { type: 'discard'; tab: number }
	/** Pointer events, in CSS pixels from the top left of the canvas. */
	| { type: 'click'; x: number; y: number }
	/** Collapses every box into its row, leaving the root, or shows every box again. */
	| { type: 'collapse'; collapsed: boolean }
	| { type: 'hover'; x: number; y: number }
	/** The pointer left the canvas. */
	| { type: 'leave' }
	/**
	 * Marks the row that holds byte `offset` of the source of the graph on
	 * screen, or none. With `reveal`, a row off the screen is brought onto it.
	 */
	| { type: 'locate'; offset: number | null; reveal: boolean }
	/**
	 * Finds the rows whose key or value holds `text`, ignoring case unless
	 * `matchCase`, marks them, and goes to the first. No text finds nothing.
	 * The search is made again in each document shown after it.
	 */
	| { type: 'search'; text: string; matchCase: boolean }
	/** Goes to the next row found, or with -1 to the one before, round from the last to the first. */
	| { type: 'step'; by: 1 | -1 }
	| { type: 'export'; id: number; options: ExportOptions };

/** The steps of a load. Only YAML is converted, to JSON, and how far that has got is not known. */
export type LoadPhase = 'converting' | 'reading' | 'parsing' | 'layout';

/** Progress and outcome of the load with the same `id`. */
export type LoadEvent =
	| { type: 'progress'; id: number; phase: LoadPhase; fraction: number }
	/** With `restored`, the graph is one a tab kept, as it was left, rather than a new one. */
	| { type: 'ready'; id: number; stats: GraphStats; restored: boolean }
	| { type: 'error'; id: number; message: string };

/**
 * A row of the graph on screen was clicked, which is bytes `start` to `end` of
 * its source: its value, or, on the edge of a box, the brackets and all between
 * them. A click away from the boxes leaves `range` none.
 */
export interface LinkEvent {
	type: 'link';
	range: { start: number; end: number } | null;
}

/**
 * What the search found in the graph on screen: `count` rows, of which the
 * one at `current` is gone to, or none while `current` is -1.
 */
export interface FoundEvent {
	type: 'found';
	count: number;
	current: number;
}

/**
 * The WebAssembly engine has loaded, or failed to with `error`. The worker
 * can show nothing before it has, and nothing at all if it failed.
 */
export interface EngineEvent {
	type: 'engine';
	error: string | null;
}

export type FromWorker =
	| LoadEvent
	| EngineEvent
	| LinkEvent
	| FoundEvent
	/**
	 * The marked row is off the screen: the view should move to show this
	 * rectangle of the world. With `zoom`, a view too small to read it in is
	 * zoomed in as well.
	 */
	| { type: 'reveal'; x: number; y: number; width: number; height: number; zoom: boolean }
	/**
	 * A value was expanded or a box collapsed, or the reverse: the graph has a
	 * new size, and the view has moved so that the clicked row stays where it
	 * was on screen. After every box was collapsed or shown at once there is no
	 * such row, and `home` asks for the starting view instead.
	 */
	| {
			type: 'layout';
			x: number;
			y: number;
			k: number;
			width: number;
			height: number;
			rootTop: number;
			rootHeight: number;
			home: boolean;
	  }
	/** Whether the pointer is over something that a click expands or collapses, or selects as a whole in the code. */
	| { type: 'cursor'; expandable: boolean }
	/** The PNG asked for by the `export` with the same `id`; null when there is no graph. */
	| { type: 'image'; id: number; blob: Blob | null };
