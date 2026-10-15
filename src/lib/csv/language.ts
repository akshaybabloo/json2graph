import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Tag } from '@lezer/highlight';

/** How many colours the columns take in turn: `--csv-1` to `--csv-6`. */
const COLOURS = 6;
/** The delimiters a document may use, as `detectDelimiter` knows them. */
const DELIMITERS = [',', ';', '\t', '|'];

const columnTags = Array.from({ length: COLOURS }, () => Tag.define());
const delimiterTag = Tag.define();

interface State {
	/** The column of the field being read. */
	column: number;
	/** Whether a quoted field is open, which a line break does not end. */
	quoted: boolean;
	/** Whether the next character starts a field, where a quote opens one. */
	fieldStart: boolean;
	/** The delimiter, from the first line, once it is read. */
	delimiter: string | null;
}

/** The delimiter that `line`, the first of the document, has the most of. */
function delimiterOf(line: string): string {
	let best = DELIMITERS[0];
	let most = 0;
	for (const delimiter of DELIMITERS) {
		const count = line.split(delimiter).length - 1;
		if (count > most) {
			best = delimiter;
			most = count;
		}
	}
	return best;
}

/**
 * Colours each column of a CSV document in turn, so that the fields of a
 * column can be followed down the lines. Quoting is read as the graph and the
 * table read it: a quote opens a field only at its start, and a quoted field
 * goes on over line breaks, with quotes doubled inside it.
 */
const csv = StreamLanguage.define<State>({
	name: 'csv',
	startState: () => ({ column: 0, quoted: false, fieldStart: true, delimiter: null }),
	copyState: (state) => ({ ...state }),
	token(stream, state) {
		state.delimiter ??= delimiterOf(stream.string);
		if (stream.sol() && !state.quoted) {
			state.column = 0;
			state.fieldStart = true;
		}
		const style = `column${state.column % COLOURS}`;
		if (state.fieldStart && stream.peek() === '"') {
			stream.next();
			state.quoted = true;
		}
		state.fieldStart = false;
		if (state.quoted) {
			while (!stream.eol()) {
				if (stream.next() !== '"') continue;
				if (stream.peek() === '"') stream.next();
				else {
					state.quoted = false;
					break;
				}
			}
			return style;
		}
		if (stream.peek() === state.delimiter) {
			stream.next();
			state.column += 1;
			state.fieldStart = true;
			return 'delimiter';
		}
		const delimiter = state.delimiter;
		stream.eatWhile((c) => c !== delimiter);
		return style;
	},
	tokenTable: {
		...Object.fromEntries(columnTags.map((tag, column) => [`column${column}`, tag])),
		delimiter: delimiterTag
	}
});

const colours = HighlightStyle.define([
	...columnTags.map((tag, column) => ({ tag, color: `var(--csv-${column + 1})` })),
	{ tag: delimiterTag, color: 'var(--muted-foreground)' }
]);

/** What the editor knows of CSV: the colours of its columns. */
export function csvLanguage(): Extension {
	return [csv, syntaxHighlighting(colours)];
}
