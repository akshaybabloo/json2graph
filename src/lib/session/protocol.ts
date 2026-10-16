/** Messages between the page and the worker that keeps the tabs in IndexedDB. */

import type { PlotChoice } from '../csv/plot';
import type { View } from '../graph/controller';

/** What is kept of a tab besides its content. */
export interface TabRecord {
	id: number;
	/** Name of the file it was opened from, or the name it was given; none for a typed document. */
	name: string | null;
	/** Whether its content is a file too large for the editor, rather than the text in it. */
	file: boolean;
	/** Id of the type of its document, and whether it was chosen rather than detected. */
	type: string;
	typeChosen: boolean;
	/** Size of its content when it was last saved, so that content gone missing can be told from none. */
	size: number;
	view: View | null;
	/** What is plotted of its table; none for a session saved before there were plots. */
	plot?: PlotChoice | null;
}

/** The tabs in their order, and which one was on screen. */
export interface Session {
	tabs: TabRecord[];
	active: number;
}

export type SessionCall =
	/** The saved session, and the content of each tab that has some. */
	| { method: 'load' }
	| { method: 'saveSession'; session: Session }
	/** Keeps `content` as what tab `id` holds, in place of what it held. */
	| { method: 'saveContent'; id: number; content: Blob }
	| { method: 'deleteContent'; id: number }
	/** The content kept for tab `id`, which is read from disk only when it is used. */
	| { method: 'readContent'; id: number }
	/** Forgets the session and every tab's content. */
	| { method: 'clear' };

/**
 * A session as it is read back, which may have been saved by an older
 * version of the page: before there were types, its tabs had none.
 */
export interface StoredSession {
	tabs: (Omit<TabRecord, 'type' | 'typeChosen'> &
		Partial<Pick<TabRecord, 'type' | 'typeChosen'>>)[];
	active: number;
}

export type SessionResult = {
	load: { session: StoredSession | null; contents: [number, Blob][] };
	saveSession: void;
	saveContent: void;
	deleteContent: void;
	readContent: Blob | null;
	clear: void;
};

export type ToSessionWorker = { call: number } & SessionCall;

export type FromSessionWorker =
	{ call: number; ok: true; result: unknown } | { call: number; ok: false; error: string };
