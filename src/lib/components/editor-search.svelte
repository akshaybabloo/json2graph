<script lang="ts">
	import {
		closeSearchPanel,
		findNext,
		findPrevious,
		getSearchQuery,
		replaceAll,
		replaceNext,
		SearchQuery,
		selectMatches,
		setSearchQuery
	} from '@codemirror/search';
	import { EditorView, runScopeHandlers, type ViewUpdate } from '@codemirror/view';
	import { onMount } from 'svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import SearchBar from './search-bar.svelte';

	/** At most how many matches are counted, past which there are said to be more. */
	const MAX_MATCHES = 10_000;
	/** How long a search may run before it lets the page get on, in milliseconds. */
	const SLICE = 8;
	/** How many characters of the document a plain search looks through at a time. */
	const CHUNK = 1 << 20;
	/** How long edits must pause before the matches are counted again. */
	const RECOUNT_DELAY = 150;

	/**
	 * The search of the code: CodeMirror's search panel, as the same bar that
	 * searches the graph. It counts the matches without holding up typing, a
	 * slice at a time, and goes to the first after the cursor as it is typed.
	 */
	let { view }: { view: EditorView } = $props();

	// svelte-ignore state_referenced_locally
	let query = getSearchQuery(view.state);
	let text = $state(query.search);
	let matchCase = $state(query.caseSensitive);
	let regexp = $state(query.regexp);
	let wholeWord = $state(query.wholeWord);
	let replacement = $state(query.replace);
	let replacing = $state(false);
	let count = $state(0);
	let current = $state(-1);
	let more = $state(false);
	let invalid = $state(false);
	let bar = $state<SearchBar>();

	/** Where the matches counted start and end, in order. */
	let froms: number[] = [];
	let tos: number[] = [];
	let slice: ReturnType<typeof setTimeout> | undefined;
	let recount: ReturnType<typeof setTimeout> | undefined;

	export function focus() {
		bar?.focus();
	}

	export function showReplace() {
		if (!view.state.readOnly) bar?.showReplace();
	}

	/** Takes in what the editor did: the query set from elsewhere, an edit, the cursor moved. */
	export function update(update: ViewUpdate) {
		for (const tr of update.transactions) {
			for (const effect of tr.effects) {
				if (effect.is(setSearchQuery) && !effect.value.eq(query)) adopt(effect.value);
			}
		}
		if (update.docChanged) {
			stop();
			recount = setTimeout(() => countMatches(false), RECOUNT_DELAY);
		} else if (update.selectionSet) {
			current = indexOfSelection();
		}
	}

	/** The query that was set from elsewhere, as Ctrl+F does with the text selected. */
	function adopt(next: SearchQuery) {
		const found = finds(next) !== finds(query);
		query = next;
		text = next.search;
		matchCase = next.caseSensitive;
		regexp = next.regexp;
		wholeWord = next.wholeWord;
		replacement = next.replace;
		if (found) countMatches(false);
	}

	/** What a query finds, which its replacement has no part in. */
	function finds(q: SearchQuery) {
		return JSON.stringify([q.search, q.caseSensitive, q.regexp, q.wholeWord]);
	}

	/** Sets the query as the bar has it, and finds what it finds unless only the replacement changed. */
	function commit() {
		const next = new SearchQuery({
			search: text,
			caseSensitive: matchCase,
			regexp,
			wholeWord,
			replace: replacement
		});
		if (next.eq(query)) return;
		const found = finds(next) !== finds(query);
		query = next;
		view.dispatch({ effects: setSearchQuery.of(next) });
		if (found) countMatches(true);
	}

	function stop() {
		clearTimeout(slice);
		clearTimeout(recount);
		slice = recount = undefined;
	}

	/**
	 * Counts the matches of the query from the start, a slice at a time; with
	 * `go`, it goes to the first at or after the cursor, or else the first.
	 */
	function countMatches(go: boolean) {
		stop();
		froms = [];
		tos = [];
		current = -1;
		const q = query;
		const { state } = view;
		invalid = q.search !== '' && !q.valid;
		if (!q.valid) {
			count = 0;
			more = false;
			return;
		}
		const cursorAt = state.selection.main.from;
		const length = state.doc.length;
		// A string is looked for a chunk at a time, overlapping by its length so that one across the
		// edge is found. A regular expression is matched on a line at once, which is quick enough.
		const chunk = q.regexp ? length : CHUNK;
		const overlap = q.search.length;
		let start = 0;
		let cursor = q.getCursor(state, 0, Math.min(length, chunk + overlap));
		more = true;

		const run = () => {
			const until = performance.now() + SLICE;
			while (froms.length < MAX_MATCHES) {
				const next = cursor.next();
				if (next.done || next.value.from >= start + chunk) {
					if (start + chunk >= length) {
						more = false;
						break;
					}
					// One that starts in the next chunk is found there; it begins after the last one ends.
					start = Math.max(start + chunk, tos.at(-1) ?? 0);
					cursor = q.getCursor(state, start, Math.min(length, start + chunk + overlap));
				} else {
					froms.push(next.value.from);
					tos.push(next.value.to);
					if (go && next.value.from >= cursorAt) {
						go = false;
						select(next.value.from, next.value.to);
					}
				}
				if (performance.now() > until) {
					count = froms.length;
					slice = setTimeout(run);
					return;
				}
			}
			slice = undefined;
			count = froms.length;
			if (go && count > 0) {
				// The first after the cursor is past those counted: CodeMirror looks for it.
				if (more) findNext(view);
				else select(froms[0], tos[0]);
			}
			current = indexOfSelection();
		};
		run();
	}

	function select(from: number, to: number) {
		view.dispatch({
			selection: { anchor: from, head: to },
			effects: EditorView.scrollIntoView(from, { y: 'nearest' }),
			userEvent: 'select.search'
		});
	}

	/** Which of the matches is selected, or -1. */
	function indexOfSelection() {
		const { from, to } = view.state.selection.main;
		let lo = 0;
		let hi = froms.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (froms[mid] < from) lo = mid + 1;
			else hi = mid;
		}
		return froms[lo] === from && tos[lo] === to ? lo : -1;
	}

	function close() {
		stop();
		closeSearchPanel(view);
	}

	onMount(() => {
		countMatches(false);
		return stop;
	});
</script>

<!-- CodeMirror mounts it apart from the page, out of reach of the page's provider. -->
<Tooltip.Provider>
	<SearchBar
		bind:this={bar}
		bind:text
		bind:matchCase
		bind:regexp
		bind:wholeWord
		bind:replacement={
			() => (view.state.readOnly ? undefined : replacement), (value) => (replacement = value ?? '')
		}
		bind:replacing
		label="Find in the code"
		class="p-1.5"
		{count}
		{current}
		{more}
		{invalid}
		delay={0}
		onsearch={commit}
		onstep={(by) => (by > 0 ? findNext : findPrevious)(view)}
		onclose={close}
		onselectall={() => selectMatches(view)}
		onreplace={() => replaceNext(view)}
		onreplaceall={() => replaceAll(view)}
		onkey={(event) => runScopeHandlers(view, event, 'search-panel')}
	/>
</Tooltip.Provider>
