/** Messages between the page and the worker that keeps the tabs in IndexedDB. */

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
	| { method: 'readContent'; id: number };

export type SessionResult = {
	load: { session: Session | null; contents: [number, Blob][] };
	saveSession: void;
	saveContent: void;
	deleteContent: void;
	readContent: Blob | null;
};

export type ToSessionWorker = { call: number } & SessionCall;

export type FromSessionWorker =
	{ call: number; ok: true; result: unknown } | { call: number; ok: false; error: string };
