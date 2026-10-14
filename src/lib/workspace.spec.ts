import { describe, expect, it } from 'vitest';
import { DISCARD_AFTER, KEEP_LIMIT, newTab, toDiscard, type Tab } from './workspace';

const MB = 1024 * 1024;
const NOW = 1_000_000_000;

function tab(id: number, hiddenFor: number, bytes = MB, indexed = true): Tab {
	return { ...newTab(id), indexed, bytes, hiddenAt: NOW - hiddenFor };
}

function ids(tabs: Tab[]): number[] {
	return tabs.map((t) => t.id).sort();
}

describe('toDiscard', () => {
	it('frees the tabs hidden for too long, and keeps the others', () => {
		const tabs = [tab(1, 0), tab(2, DISCARD_AFTER - 1), tab(3, DISCARD_AFTER), tab(4, 1e9)];
		expect(ids(toDiscard(tabs, 0, NOW))).toEqual([3, 4]);
	});

	it('never frees the tab on screen, or a tab with nothing kept', () => {
		const tabs = [tab(1, 1e9), tab(2, 1e9, MB, false)];
		expect(toDiscard(tabs, 1, NOW)).toEqual([]);
	});

	it('frees the least recently used tabs beyond the limit', () => {
		const half = KEEP_LIMIT / 2;
		const tabs = [tab(1, 3000, half), tab(2, 1000, half), tab(3, 2000, half), tab(4, 4000, MB)];
		// Tabs 2 and 3 were used last, and fill the limit.
		expect(ids(toDiscard(tabs, 0, NOW))).toEqual([1, 4]);
	});
});
