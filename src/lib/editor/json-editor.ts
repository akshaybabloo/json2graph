import { isolateHistory } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { MONO_FONT } from '../fonts';
import { indentGuides } from './indent-guides';

/** How long typing must pause before an edit is reported. */
const EDIT_DELAY = 300;

/** Marks a change made by `setText`, which is not an edit. */
const external = Annotation.define<boolean>();

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
		{ backgroundColor: 'color-mix(in oklch, var(--ring) 40%, transparent)' },
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
};

/** A CodeMirror editor for JSON that reports edits once typing pauses. */
export class JsonEditor {
	#view: EditorView;
	#extensions: Extension[];
	#timer: ReturnType<typeof setTimeout> | undefined;
	#onEdit: (text: string) => void;

	constructor(parent: HTMLElement, { onEdit, onFormat, onEmpty }: EditorHandlers) {
		this.#onEdit = onEdit;
		this.#extensions = [
			basicSetup,
			json(),
			theme,
			syntaxHighlighting(highlighting),
			indentGuides,
			EditorView.contentAttributes.of({ 'aria-label': 'JSON source' }),
			placeholder('Type or paste JSON here'),
			keymap.of([{ key: 'Shift-Alt-f', run: () => (onFormat(), true) }]),
			// Dropped files are opened by the page, not inserted as text.
			EditorView.domEventHandlers({
				drop: (event) => Boolean(event.dataTransfer?.files.length)
			}),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				const empty = update.state.doc.length === 0;
				if (empty !== (update.startState.doc.length === 0)) onEmpty(empty);
				if (update.transactions.some((tr) => tr.annotation(external))) return;
				this.#cancel();
				this.#timer = setTimeout(() => {
					this.#timer = undefined;
					onEdit(this.#view.state.doc.toString());
				}, EDIT_DELAY);
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
	restore(saved: EditorState | string) {
		this.#cancel();
		this.#view.setState(
			typeof saved === 'string'
				? EditorState.create({ doc: saved, extensions: this.#extensions })
				: saved
		);
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
