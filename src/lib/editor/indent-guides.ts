import { RangeSetBuilder, type EditorState, type Line } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';

/** Lines read from the top of the document to find its indent width. */
const SAMPLE_LINES = 200;
/** Characters read from the start of a line; indentation is never longer in practice. */
const MAX_INDENT = 512;
/** How far below a blank line to look for the line that gives it its guides. */
const BLANK_LOOKAHEAD = 50;

/** Width in columns of the whitespace that starts `line`, or -1 if the line is blank. */
function indentColumns(state: EditorState, line: Line): number {
	// Only the start of the line is read: a minified document is one huge line.
	const text = state.sliceDoc(line.from, Math.min(line.to, line.from + MAX_INDENT));
	let columns = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		if (char === 32) columns += 1;
		else if (char === 9) columns += state.tabSize - (columns % state.tabSize);
		else return columns;
	}
	return -1;
}

/** Columns per nesting level: the indentation of the first indented line. */
function indentUnit(state: EditorState): number {
	const lines = Math.min(state.doc.lines, SAMPLE_LINES);
	for (let number = 1; number <= lines; number++) {
		const columns = indentColumns(state, state.doc.line(number));
		if (columns > 0) return columns;
	}
	return state.tabSize;
}

/** A blank line continues the guides of the next line that has text. */
function blankLineColumns(state: EditorState, line: Line): number {
	const last = Math.min(state.doc.lines, line.number + BLANK_LOOKAHEAD);
	for (let number = line.number + 1; number <= last; number++) {
		const columns = indentColumns(state, state.doc.line(number));
		if (columns >= 0) return columns;
	}
	return 0;
}

function guides(view: EditorView): DecorationSet {
	const { state } = view;
	const unit = indentUnit(state);
	const byLevel = new Map<number, Decoration>();
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to;) {
			const line = state.doc.lineAt(pos);
			let columns = indentColumns(state, line);
			if (columns < 0) columns = blankLineColumns(state, line);
			const levels = Math.floor(columns / unit);
			if (levels > 0) {
				let guide = byLevel.get(levels);
				if (!guide) {
					guide = Decoration.line({
						class: 'cm-indent-guides',
						attributes: { style: `--indent-levels: ${levels}; --indent-unit: ${unit}ch` }
					});
					byLevel.set(levels, guide);
				}
				builder.add(line.from, line.from, guide);
			}
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

/**
 * A vertical line at each level of indentation, so the extent of every object
 * and array can be followed down the page.
 */
export const indentGuides = [
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = guides(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) this.decorations = guides(update.view);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	),
	// One 1px line per level, drawn behind the text from the start of the line.
	EditorView.baseTheme({
		'.cm-indent-guides': {
			backgroundImage:
				'repeating-linear-gradient(to right, var(--indent-guide, currentColor) 0 1px, transparent 1px var(--indent-unit))',
			backgroundSize: 'calc(var(--indent-levels) * var(--indent-unit)) 100%',
			backgroundRepeat: 'no-repeat',
			backgroundOrigin: 'content-box'
		}
	})
];
