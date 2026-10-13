import { isolateHistory } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation } from '@codemirror/state';
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

/** A CodeMirror editor for JSON that reports edits once typing pauses. */
export class JsonEditor {
	#view: EditorView;
	#timer: ReturnType<typeof setTimeout> | undefined;

	/** `onFormat` is called when the keys that format a document are pressed. */
	constructor(parent: HTMLElement, onEdit: (text: string) => void, onFormat: () => void) {
		this.#view = new EditorView({
			parent,
			extensions: [
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
					if (update.transactions.some((tr) => tr.annotation(external))) return;
					clearTimeout(this.#timer);
					this.#timer = setTimeout(() => onEdit(this.#view.state.doc.toString()), EDIT_DELAY);
				})
			]
		});
	}

	/** Replaces the document without reporting an edit. */
	setText(text: string) {
		clearTimeout(this.#timer);
		this.#view.dispatch({
			changes: { from: 0, to: this.#view.state.doc.length, insert: text },
			annotations: external.of(true)
		});
	}

	get text(): string {
		return this.#view.state.doc.toString();
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

	destroy() {
		clearTimeout(this.#timer);
		this.#view.destroy();
	}
}
