/**
 * Finds where the records of a CSV text start, off the page's thread, so
 * that the table can read just the rows it shows, and what each column holds.
 */
import { ColumnKinds, type Kind } from './columns';
import { detectDelimiter, parseRecords } from './csv';

/** What the worker is sent: a text to find the records of. */
export type RowsRequest = { id: number; text: string };
/** Where each record starts, the header's included, the delimiter, and what each column holds. */
export type Rows = { id: number; delimiter: string; starts: Uint32Array; kinds: Kind[] };

addEventListener('message', (event: MessageEvent<RowsRequest>) => {
	const { id, text } = event.data;
	const delimiter = detectDelimiter(text.slice(0, 64 * 1024)) ?? ',';
	let starts = new Uint32Array(1024);
	let count = 0;
	let columns = 0;
	const kinds = new ColumnKinds();
	parseRecords(text, delimiter, true, (fields, start) => {
		if (count === 0) columns = fields.length;
		else kinds.add(fields);
		if (count === starts.length) {
			const grown = new Uint32Array(starts.length * 2);
			grown.set(starts);
			starts = grown;
		}
		starts[count++] = start;
	});
	const found = starts.slice(0, count);
	postMessage({ id, delimiter, starts: found, kinds: kinds.kinds(columns) } satisfies Rows, {
		transfer: [found.buffer]
	});
});
