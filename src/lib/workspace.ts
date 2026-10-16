import type { EditorState } from '@codemirror/state';
import type { PlotChoice } from './csv/plot';
import { DEFAULT_TYPE } from './document-types';
import type { View } from './graph/controller';

/**
 * A document open in a tab. The tab on screen has its text in the editor and
 * its graph in the engine; the others keep what it takes to show them again.
 */
export type Tab = {
	id: number;
	/** Name of the file it was opened from; none for a document that was typed. */
	name: string | null;
	/** A file too large for the editor, which the graph is drawn from instead. */
	file: Blob | null;
	/**
	 * Its text while another tab is on screen: the editor's state, a text that
	 * was read meanwhile, or the copy in the browser's storage, which is read
	 * only when the tab is shown.
	 */
	saved: EditorState | string | Blob | null;
	/** Whether its content was not kept when the page was closed, so that it cannot be shown. */
	lost: boolean;
	/** Id of the type of its document. */
	type: string;
	/** Whether the type was chosen, rather than detected, which then stops. */
	typeChosen: boolean;
	/** Where its graph was panned and zoomed to when another tab was shown. */
	view: View | null;
	/** Whether every node was last collapsed, rather than shown. */
	allCollapsed: boolean;
	/** What is plotted of its table, beside the graph; none when nothing is. */
	plot: PlotChoice | null;
	/** What was wrong with its text when another tab was shown. */
	error: string | null;
	/**
	 * Whether the engine keeps its indexed document, so that it is shown at
	 * once and as it was left. Otherwise showing it indexes the document again.
	 */
	indexed: boolean;
	/** Whether its indexed document was freed while it was hidden, to save memory. */
	discarded: boolean;
	/** Size of the document the engine keeps. */
	bytes: number;
	/** When another tab was last shown in its place, in milliseconds since the epoch. */
	hiddenAt: number;
	/** Which read of a file it is waiting for; a newer read, or clearing it, abandons the old one. */
	reading: number;
};

export function newTab(id: number): Tab {
	return {
		id,
		name: null,
		file: null,
		saved: null,
		lost: false,
		type: DEFAULT_TYPE.id,
		typeChosen: false,
		view: null,
		allCollapsed: false,
		plot: null,
		error: null,
		indexed: false,
		discarded: false,
		bytes: 0,
		hiddenAt: 0,
		reading: 0
	};
}

/** What a tab is called on screen. */
export function tabLabel(tab: Tab): string {
	return tab.name ?? 'Untitled';
}

/** How long a hidden tab keeps its indexed document, like a browser that discards tabs left unused. */
export const DISCARD_AFTER = 10 * 60 * 1000;
/** How much JSON the hidden tabs keep indexed between them; the least recently used go first. */
export const KEEP_LIMIT = 512 * 1024 * 1024;
/**
 * Above this many characters, the text of a tab whose graph was discarded is
 * left in the browser's storage too, and read back when the tab is shown.
 * Below it the text stays, with its undo history.
 */
export const DROP_TEXT_OVER = 1_000_000;

/**
 * The hidden tabs whose indexed documents should be freed: those hidden for
 * longer than `DISCARD_AFTER`, and the least recently used of the rest beyond
 * `KEEP_LIMIT`.
 */
export function toDiscard(tabs: Tab[], active: number, now: number): Tab[] {
	const hidden = tabs
		.filter((tab) => tab.id !== active && tab.indexed)
		.sort((a, b) => b.hiddenAt - a.hiddenAt);
	const discard: Tab[] = [];
	let kept = 0;
	for (const tab of hidden) {
		if (now - tab.hiddenAt >= DISCARD_AFTER || kept + tab.bytes > KEEP_LIMIT) {
			discard.push(tab);
		} else {
			kept += tab.bytes;
		}
	}
	return discard;
}
