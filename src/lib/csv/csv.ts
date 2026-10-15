/**
 * Comma-separated values, as RFC 4180 has them: a field may be quoted, a
 * quoted field may hold the delimiter, line breaks and quotes doubled, and
 * records end at a line break (LF, CRLF or CR). Blank lines are no records.
 *
 * The engine indexes CSV for the graph by the same rules (`crates/engine/src/csv.rs`);
 * this reads it for the table, from the text in the editor.
 */

const QUOTE = 34;
const LF = 10;
const CR = 13;

/** The delimiters `detectDelimiter` chooses from, the most usual first. */
const DELIMITERS = [',', ';', '\t', '|'];
/** How many lines `detectDelimiter` compares. */
const SAMPLE_LINES = 10;

/**
 * The delimiter that the first lines of `text` share the most, and on how
 * many of them it agrees: the one that appears the same number of times, at
 * least once, on the most lines.
 */
function sharedDelimiter(text: string): { delimiter: string; lines: number } | null {
	const lines = text.split(/\r\n|\n|\r/, SAMPLE_LINES).filter((line) => line !== '');
	let best: { delimiter: string; lines: number } | null = null;
	for (const delimiter of DELIMITERS) {
		const counts = lines.map((line) => line.split(delimiter).length - 1);
		const agreeing = counts.filter((count) => count > 0 && count === counts[0]).length;
		if (agreeing > (best?.lines ?? 0)) best = { delimiter, lines: agreeing };
	}
	return best;
}

/** The delimiter of the CSV text that `text` starts, or none when no delimiter appears in it. */
export function detectDelimiter(text: string): string | null {
	return sharedDelimiter(text)?.delimiter ?? null;
}

/** Whether `text` starts like a table: at least two lines that agree on a delimiter. */
export function looksLikeCsv(text: string): boolean {
	return (sharedDelimiter(text)?.lines ?? 0) >= 2;
}

/**
 * Reads the records of `text`, calling `onRecord` with the fields of each and
 * where it starts. Unless `final`, the text may stop in the middle of a
 * record: that record is left for the next call, and the return value says
 * how much of the text was read.
 */
export function parseRecords(
	text: string,
	delimiter: string,
	final: boolean,
	onRecord: (fields: string[], start: number) => void
): number {
	const separator = delimiter.charCodeAt(0);
	const end = text.length;
	let fields: string[] = [];
	let start = 0;
	let i = 0;

	const finish = () => {
		if (fields.length > 1 || fields[0] !== '') onRecord(fields, start);
		fields = [];
	};

	while (i < end) {
		let value = '';
		if (text.charCodeAt(i) === QUOTE) {
			let from = i + 1;
			for (;;) {
				const quote = text.indexOf('"', from);
				if (quote < 0 || (quote + 1 === end && !final)) {
					// The quote that closes the field, or doubles another, is still to come.
					if (!final) return start;
					value += text.slice(from);
					i = end;
					break;
				}
				if (text.charCodeAt(quote + 1) === QUOTE) {
					value += text.slice(from, quote + 1);
					from = quote + 2;
					continue;
				}
				value += text.slice(from, quote);
				i = quote + 1;
				break;
			}
		}
		// The unquoted field, or whatever follows a closing quote, up to the delimiter.
		let to = i;
		while (to < end) {
			const c = text.charCodeAt(to);
			if (c === separator || c === LF || c === CR) break;
			to++;
		}
		if (to === end && !final) return start;
		value += text.slice(i, to);
		fields.push(value);
		i = to;

		if (i === end) break;
		const c = text.charCodeAt(i);
		if (c === separator) {
			i++;
			// A delimiter at the very end leaves an empty last field.
			if (i === end) {
				if (!final) return start;
				fields.push('');
			}
			continue;
		}
		if (c === CR && i + 1 === end && !final) return start;
		i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
		finish();
		start = i;
	}
	if (fields.length) finish();
	return end;
}

/** The fields of the one record in `text`. */
export function parseRecord(text: string, delimiter: string): string[] {
	let fields: string[] = [];
	parseRecords(text, delimiter, true, (record) => {
		if (fields.length === 0) fields = record;
	});
	return fields;
}

/** What the table calls its columns: the header's names, with a blank one named after its column. */
export function columnNames(header: string[]): string[] {
	return header.map((name, column) => (name.trim() === '' ? `column ${column + 1}` : name));
}
