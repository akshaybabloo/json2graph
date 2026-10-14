import type { FromSessionWorker, SessionCall, SessionResult } from './protocol';

/** Held by the window that saves the tabs, for as long as it is open. */
const LOCK = 'json2graph-session';

/**
 * The tabs kept in IndexedDB, by a worker of their own. Only one window at a
 * time keeps them: in any other, `open` gives nothing and the tabs are not saved.
 */
export class SessionStore {
	#worker: Worker;
	#calls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	#called = 0;

	private constructor() {
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.addEventListener('message', (event: MessageEvent<FromSessionWorker>) => {
			const reply = event.data;
			const call = this.#calls.get(reply.call);
			this.#calls.delete(reply.call);
			if (reply.ok) call?.resolve(reply.result);
			else call?.reject(new Error(reply.error));
		});
	}

	/** The store, unless another window keeps the tabs or the browser keeps nothing. */
	static async open(): Promise<SessionStore | null> {
		if (typeof indexedDB === 'undefined') return null;
		if (!(await claim())) return null;
		return new SessionStore();
	}

	call<M extends SessionCall['method']>(
		request: Extract<SessionCall, { method: M }>
	): Promise<SessionResult[M]> {
		const call = ++this.#called;
		return new Promise((resolve, reject) => {
			this.#calls.set(call, { resolve: resolve as (value: unknown) => void, reject });
			this.#worker.postMessage({ call, ...request });
		});
	}

	destroy() {
		this.#worker.terminate();
	}
}

/** Whether this window gets to keep the tabs: the first window open does, until it closes. */
function claim(): Promise<boolean> {
	if (!navigator.locks) return Promise.resolve(true);
	return new Promise((resolve) => {
		navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
			resolve(lock !== null);
			// Held until the window closes.
			return lock && new Promise(() => {});
		});
	});
}
