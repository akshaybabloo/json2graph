/**
 * Keeps the tabs in IndexedDB, off the page's thread. Content arrives as
 * blobs, which are handed over without being copied, and is given back as
 * blobs that are read from disk only when they are used.
 */

import type { FromSessionWorker, SessionCall, StoredSession, ToSessionWorker } from './protocol';

const DATABASE = 'json2graph';
/** The saved session, under the key `SESSION`. */
const SESSIONS = 'session';
/** The content of each tab, by tab id. */
const CONTENTS = 'content';
const SESSION = 'tabs';

const database = new Promise<IDBDatabase>((resolve, reject) => {
	const open = indexedDB.open(DATABASE, 1);
	open.onupgradeneeded = () => {
		open.result.createObjectStore(SESSIONS);
		open.result.createObjectStore(CONTENTS);
	};
	open.onsuccess = () => resolve(open.result);
	open.onerror = () => reject(open.error);
});

/** Runs `request` in a transaction, and settles once the transaction is done. */
async function transact<T>(
	stores: string[],
	mode: IDBTransactionMode,
	request: (transaction: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
	const transaction = (await database).transaction(stores, mode);
	const pending = request(transaction);
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve(pending?.result);
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

async function load() {
	let session: StoredSession | null = null;
	const contents: [number, Blob][] = [];
	await transact([SESSIONS, CONTENTS], 'readonly', (transaction) => {
		const read = transaction.objectStore(SESSIONS).get(SESSION);
		read.onsuccess = () => (session = (read.result as StoredSession | undefined) ?? null);
		const cursor = transaction.objectStore(CONTENTS).openCursor();
		cursor.onsuccess = () => {
			const at = cursor.result;
			if (!at) return;
			contents.push([at.key as number, at.value as Blob]);
			at.continue();
		};
	});
	return { session, contents };
}

function handle(call: SessionCall): Promise<unknown> {
	switch (call.method) {
		case 'load':
			return load();
		case 'saveSession':
			return transact([SESSIONS], 'readwrite', (transaction) =>
				transaction.objectStore(SESSIONS).put(call.session, SESSION)
			);
		case 'saveContent':
			return transact([CONTENTS], 'readwrite', (transaction) =>
				transaction.objectStore(CONTENTS).put(call.content, call.id)
			);
		case 'deleteContent':
			return transact([CONTENTS], 'readwrite', (transaction) =>
				transaction.objectStore(CONTENTS).delete(call.id)
			);
		case 'clear':
			return transact([SESSIONS, CONTENTS], 'readwrite', (transaction) => {
				transaction.objectStore(SESSIONS).clear();
				transaction.objectStore(CONTENTS).clear();
			});
		case 'readContent':
			return transact([CONTENTS], 'readonly', (transaction) =>
				transaction.objectStore(CONTENTS).get(call.id)
			).then((content) => (content as Blob | undefined) ?? null);
	}
}

addEventListener('message', async (event: MessageEvent<ToSessionWorker>) => {
	const { call, ...request } = event.data;
	let reply: FromSessionWorker;
	try {
		reply = { call, ok: true, result: await handle(request) };
	} catch (error) {
		reply = { call, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(reply);
});
