import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	foldKeymap,
	HighlightStyle,
	indentOnInput,
	syntaxHighlighting
} from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import {
	crosshairCursor,
	drawSelection,
	dropCursor,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	type Panel,
	placeholder,
	rectangularSelection
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { flushSync, mount, unmount } from 'svelte';
import EditorSearch from '../components/editor-search.svelte';
import { MONO_FONT } from '../fonts';
import { indentGuides } from './indent-guides';

/** How long typing must pause before an edit is reported. */
const EDIT_DELAY = 300;

/** The search bar open in each editor. */
const searchBars = new WeakMap<EditorView, ReturnType<typeof mountSearch>>();

function mountSearch(view: EditorView, target: HTMLElement) {
	const bar = mount(EditorSearch, { target, props: { view } });
	// So that it can be focused, or its replacement shown, before the page updates.
	flushSync();
	return bar;
}

/** CodeMirror's search panel, as the bar that searches the graph too, at the top of the editor. */
function searchPanel(view: EditorView): Panel {
	const dom = document.createElement('div');
	const bar = mountSearch(view, dom);
	searchBars.set(view, bar);
	return {
		dom,
		top: true,
		mount: () => bar.focus(),
		update: (update) => bar.update(update),
		destroy: () => {
			if (searchBars.get(view) === bar) searchBars.delete(view);
			void unmount(bar);
		}
	};
}

/** Opens the search with the box of the replacement shown. */
function openReplace(view: EditorView) {
	openSearchPanel(view);
	searchBars.get(view)?.showReplace();
	return true;
}

/**
 * CodeMirror's basic setup, less the highlight of every other copy of the
 * text selected, which marks every bracket in a document of JSON.
 */
const setup: Extension = [
	lineNumbers(),
	highlightActiveLineGutter(),
	highlightSpecialChars(),
	history(),
	foldGutter(),
	drawSelection(),
	dropCursor(),
	EditorState.allowMultipleSelections.of(true),
	indentOnInput(),
	syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	bracketMatching(),
	closeBrackets(),
	autocompletion(),
	rectangularSelection(),
	crosshairCursor(),
	highlightActiveLine(),
	search({ top: true, createPanel: searchPanel }),
	keymap.of([
		{ key: 'Mod-Shift-f', run: openReplace, preventDefault: true },
		...closeBracketsKeymap,
		...defaultKeymap,
		...searchKeymap,
		...historyKeymap,
		...foldKeymap,
		...completionKeymap
	])
];

/** Marks a change made by `setText`, which is not an edit. */
const external = Annotation.define<boolean>();
/** Marks a selection made by `select`, which the user did not move to. */
const shown = Annotation.define<boolean>();

// Colours come from the page's design tokens, so the editor follows the theme
// (and the `.dark` class) without being rebuilt.
const theme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: '13px',
		color: 'var(--foreground)',
		backgroundColor: 'var(--background)'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-indent-guides': { '--indent-guide': 'var(--graph-border)' },
	'.cm-scroller': { fontFamily: MONO_FONT, lineHeight: '1.5' },
	'.cm-content': { caretColor: 'var(--foreground)' },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
	'.cm-gutters': {
		color: 'var(--muted-foreground)',
		backgroundColor: 'var(--background)',
		borderRight: '1px solid var(--border)'
	},
	'.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 50%, transparent)' },
	'.cm-activeLineGutter': { color: 'var(--foreground)', backgroundColor: 'var(--muted)' },
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
		// In the colour that marks the same row in the graph.
		{ backgroundColor: 'color-mix(in oklch, var(--brand) 45%, transparent)' },
	'&.cm-focused .cm-matchingBracket': {
		backgroundColor: 'color-mix(in oklch, var(--ring) 40%, transparent)'
	},
	'.cm-foldPlaceholder': {
		color: 'var(--muted-foreground)',
		backgroundColor: 'var(--muted)',
		border: 'none'
	},
	'.cm-panels': {
		color: 'var(--foreground)',
		backgroundColor: 'var(--card)',
		borderColor: 'var(--border)'
	},
	// As the graph marks what its search found.
	'.cm-searchMatch': {
		backgroundColor: 'color-mix(in oklch, var(--graph-found) 30%, transparent)'
	},
	'.cm-searchMatch-selected': { outline: '1px solid var(--graph-found)' },
	'.cm-tooltip': {
		color: 'var(--popover-foreground)',
		backgroundColor: 'var(--popover)',
		border: '1px solid var(--border)'
	},
	'.cm-textfield, .cm-button': {
		color: 'var(--foreground)',
		backgroundColor: 'var(--background)',
		backgroundImage: 'none',
		border: '1px solid var(--border)'
	}
});

// The same colours the graph uses for the same kinds of value.
const highlighting = HighlightStyle.define([
	{ tag: tags.propertyName, color: 'var(--foreground)' },
	{ tag: tags.string, color: 'var(--json-string)' },
	{ tag: tags.number, color: 'var(--json-number)' },
	{ tag: tags.bool, color: 'var(--json-boolean)' },
	{ tag: tags.null, color: 'var(--muted-foreground)' },
	{ tag: [tags.separator, tags.squareBracket, tags.brace], color: 'var(--muted-foreground)' }
]);

/** What the editor tells the page. */
export type EditorHandlers = {
	/** The text after an edit, once typing pauses. */
	onEdit: (text: string) => void;
	/** The keys that format a document were pressed. */
	onFormat: () => void;
	/** The editor became empty, or is no longer empty. */
	onEmpty: (empty: boolean) => void;
	/** The user moved the cursor, which is now at `offset`. */
	onCursor?: (offset: number) => void;
};

/** A CodeMirror editor for the document of a tab, in its language, that reports edits once typing pauses. */
export class JsonEditor {
	#view: EditorView;
	#extensions: Extension[];
	/** The language of the document, which its type decides. */
	#language = new Compartment();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#onEdit: (text: string) => void;

	constructor(parent: HTMLElement, { onEdit, onFormat, onEmpty, onCursor }: EditorHandlers) {
		this.#onEdit = onEdit;
		this.#extensions = [
			setup,
			this.#language.of([]),
			theme,
			syntaxHighlighting(highlighting),
			indentGuides,
			EditorView.contentAttributes.of({ 'aria-label': 'Source' }),
			placeholder('Type or paste here'),
			keymap.of([{ key: 'Shift-Alt-f', run: () => (onFormat(), true) }]),
			// Dropped files are opened by the page, not inserted as text.
			EditorView.domEventHandlers({
				drop: (event) => Boolean(event.dataTransfer?.files.length)
			}),
			EditorView.updateListener.of((update) => {
				const marked = (type: typeof external) =>
					update.transactions.some((tr) => tr.annotation(type));
				if (update.docChanged) {
					const empty = update.state.doc.length === 0;
					if (empty !== (update.startState.doc.length === 0)) onEmpty(empty);
					if (!marked(external)) {
						this.#cancel();
						this.#timer = setTimeout(() => {
							this.#timer = undefined;
							onEdit(this.#view.state.doc.toString());
						}, EDIT_DELAY);
					}
				}
				// After an edit is noted as waiting, so that it is pending when the cursor is reported.
				if (update.selectionSet && !marked(external) && !marked(shown)) {
					onCursor?.(update.state.selection.main.head);
				}
			})
		];
		this.#view = new EditorView({ parent, extensions: this.#extensions });
	}

	/** Replaces the document without reporting an edit. */
	setText(text: string) {
		this.#cancel();
		this.#view.dispatch({
			changes: { from: 0, to: this.#view.state.doc.length, insert: text },
			annotations: external.of(true)
		});
	}

	get text(): string {
		return this.#view.state.doc.toString();
	}

	/** Reports the edit that is waiting for typing to pause, at once. */
	flush() {
		if (this.#timer === undefined) return;
		this.#cancel();
		this.#onEdit(this.text);
	}

	/** Whether an edit is waiting for typing to pause before it is reported. */
	get pending(): boolean {
		return this.#timer !== undefined;
	}

	/** The first `length` characters of the document. */
	head(length: number): string {
		return this.#view.state.doc.sliceString(0, length);
	}

	get empty(): boolean {
		return this.#view.state.doc.length === 0;
	}

	/** Everything the editor holds of its document: the text, the selection and the undo history. */
	get state(): EditorState {
		return this.#view.state;
	}

	/**
	 * Shows another document, without reporting an edit: a state this editor
	 * gave out, which brings back its selection and undo history, or a text.
	 */
	restore(saved: EditorState | string, language: Extension) {
		this.#cancel();
		if (typeof saved !== 'string') {
			this.#view.setState(saved);
			return;
		}
		const state = EditorState.create({ doc: saved, extensions: this.#extensions });
		this.#view.setState(state.update({ effects: this.#language.reconfigure(language) }).state);
	}

	/** Selects `from` to `to` and scrolls it into view, without reporting the cursor as moved. */
	select(from: number, to: number) {
		this.#view.dispatch({
			selection: { anchor: from, head: to },
			effects: EditorView.scrollIntoView(from, { y: 'center' }),
			annotations: shown.of(true)
		});
	}

	/** Leaves the cursor where it is, with nothing selected, without reporting it as moved. */
	deselect() {
		const { head } = this.#view.state.selection.main;
		this.#view.dispatch({ selection: { anchor: head }, annotations: shown.of(true) });
	}

	/** Where the cursor is. */
	get cursor(): number {
		return this.#view.state.selection.main.head;
	}

	/** Highlights and folds the document as being in `language`. */
	setLanguage(language: Extension) {
		this.#view.dispatch({ effects: this.#language.reconfigure(language) });
	}

	/**
	 * Replaces the document as an edit: it is reported once typing pauses, and
	 * can be undone.
	 */
	replace(text: string) {
		const { doc } = this.#view.state;
		if (doc.toString() === text) return;
		this.#view.dispatch({
			changes: { from: 0, to: doc.length, insert: text },
			// Its own step to undo, also straight after typing.
			annotations: isolateHistory.of('full')
		});
	}

	/** Drops an edit that is waiting to be reported. */
	#cancel() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	focus() {
		this.#view.focus();
	}

	destroy() {
		this.#cancel();
		this.#view.destroy();
	}
}
