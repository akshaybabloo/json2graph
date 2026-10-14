import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCall } from './protocol';
import { TabSaver } from './saver';
import type { SessionStore } from './store';

/** A store whose calls settle only when the test says so. */
class Store {
	calls: { request: SessionCall; resolve: () => void; reject: (error: Error) => void }[] = [];

	call(request: SessionCall) {
		return new Promise<void>((resolve, reject) => this.calls.push({ request, resolve, reject }));
	}

	destroy() {}

	writes() {
		return this.calls.filter((call) => call.request.method === 'saveContent');
	}
}

function saverWith(store: Store) {
	return new TabSaver(
		store as unknown as SessionStore,
		() => ({ tabs: [], active: 1 }),
		() => {}
	);
}

describe('TabSaver', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('saves content once it stops changing', async () => {
		const store = new Store();
		const saver = saverWith(store);
		saver.content(1, new Blob(['a']));
		await vi.advanceTimersByTimeAsync(1000);
		saver.content(1, new Blob(['ab']));
		await vi.advanceTimersByTimeAsync(1999);
		expect(store.writes()).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(store.writes()).toHaveLength(1);
		expect(saver.busy).toBe(true);

		store.writes()[0].resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.isSaved(1)).toBe(true);
		expect(saver.sizeOf(1)).toBe(2);
		expect(saver.busy).toBe(false);
	});

	it('is not saved while a newer write is on its way, even when an older one finishes', async () => {
		const store = new Store();
		const saver = saverWith(store);
		saver.content(1, new Blob(['a']), true);
		await vi.advanceTimersByTimeAsync(0);
		saver.content(1, new Blob(['ab']), true);
		await vi.advanceTimersByTimeAsync(0);
		const [older, newer] = store.writes();

		older.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.isSaved(1)).toBe(false);
		expect(saver.busy).toBe(true);

		newer.reject(new Error('The quota has been exceeded.'));
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.isSaved(1)).toBe(false);
		expect(saver.busy).toBe(false);
	});
});
