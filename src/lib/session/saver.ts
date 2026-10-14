import type { Session } from './protocol';
import type { SessionStore } from './store';

/**
 * How long after its last change a tab's content is saved: a large document
 * is not written to disk again on every pause in typing.
 */
const CONTENT_DELAY = 2000;
const SESSION_DELAY = 300;

/** Saves the tabs to a `SessionStore` once they stop changing, or at once when asked. */
export class TabSaver {
	#store: SessionStore;
	#session: () => Session;
	#onError: (message: string) => void;
	#pending = new Map<
		number,
		{ content: Blob; timer: ReturnType<typeof setTimeout>; version: number }
	>();
	/** Tabs whose content has changed since it was last saved. */
	#unsaved = new Set<number>();
	/** The latest content given for each tab with unsaved content, counted up across all tabs. */
	#latest = new Map<number, number>();
	#versions = 0;
	/** Writes on their way to the store. */
	#writing = 0;
	/** Size of the content last saved for each tab. */
	#sizes = new Map<number, number>();
	#sessionTimer: ReturnType<typeof setTimeout> | undefined;
	#askedToPersist = false;

	/**
	 * `session` gives the tabs as they are when they are saved, and `onError`
	 * is told when something could not be saved.
	 */
	constructor(store: SessionStore, session: () => Session, onError: (message: string) => void) {
		this.#store = store;
		this.#session = session;
		this.#onError = onError;
	}

	/** Saves `content` as what tab `id` holds, once it stops changing, or `now`. */
	content(id: number, content: Blob, now = false) {
		this.#unsaved.add(id);
		const version = ++this.#versions;
		this.#latest.set(id, version);
		clearTimeout(this.#pending.get(id)?.timer);
		const timer = setTimeout(() => this.#write(id), now ? 0 : CONTENT_DELAY);
		this.#pending.set(id, { content, timer, version });
	}

	/** Forgets tab `id` and its content. */
	remove(id: number) {
		clearTimeout(this.#pending.get(id)?.timer);
		this.#pending.delete(id);
		this.#unsaved.delete(id);
		this.#latest.delete(id);
		this.#sizes.delete(id);
		this.#store.call({ method: 'deleteContent', id }).catch(() => {});
	}

	/** Records that tab `id` came back with content of `size`, which is saved already. */
	restored(id: number, size: number) {
		this.#sizes.set(id, size);
	}

	/** Whether the content of tab `id` is saved as it is now. */
	isSaved(id: number): boolean {
		return this.#sizes.has(id) && !this.#unsaved.has(id);
	}

	/** Whether some content is waiting to be saved, or on its way. */
	get busy(): boolean {
		return this.#pending.size > 0 || this.#writing > 0;
	}

	sizeOf(id: number): number {
		return this.#sizes.get(id) ?? 0;
	}

	/** The saved content of tab `id`, which is read from disk only when it is used. */
	read(id: number): Promise<Blob | null> {
		return this.#store.call({ method: 'readContent', id });
	}

	/** Saves the list of tabs once it stops changing. */
	session() {
		clearTimeout(this.#sessionTimer);
		this.#sessionTimer = setTimeout(() => this.#writeSession(), SESSION_DELAY);
	}

	/** Saves everything that is waiting, at once: the page is being hidden, and may be closed. */
	flush() {
		for (const id of [...this.#pending.keys()]) this.#write(id);
		this.#writeSession();
	}

	destroy() {
		for (const { timer } of this.#pending.values()) clearTimeout(timer);
		clearTimeout(this.#sessionTimer);
		this.#store.destroy();
	}

	async #write(id: number) {
		const pending = this.#pending.get(id);
		if (!pending) return;
		this.#pending.delete(id);
		clearTimeout(pending.timer);
		this.#persist();
		this.#writing += 1;
		try {
			await this.#store.call({ method: 'saveContent', id, content: pending.content });
			this.#sizes.set(id, pending.content.size);
			// Saved only once the latest content is: an older write can finish
			// while a newer one is still on its way, and the newer one can fail.
			if (this.#latest.get(id) === pending.version) {
				this.#latest.delete(id);
				this.#unsaved.delete(id);
			}
			this.session();
		} catch (error) {
			this.#onError(error instanceof Error ? error.message : String(error));
		} finally {
			this.#writing -= 1;
		}
	}

	#writeSession() {
		clearTimeout(this.#sessionTimer);
		this.#sessionTimer = undefined;
		this.#store
			.call({ method: 'saveSession', session: this.#session() })
			.catch((error: Error) => this.#onError(error.message));
	}

	/**
	 * Asks the browser not to clear the saved tabs when it runs short of space,
	 * once something is saved. Some browsers ask the user first.
	 */
	#persist() {
		if (this.#askedToPersist) return;
		this.#askedToPersist = true;
		navigator.storage?.persist?.().catch(() => {});
	}
}
