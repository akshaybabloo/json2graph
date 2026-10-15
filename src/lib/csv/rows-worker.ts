/**
 * Finds where the records of a CSV text start, off the page's thread, so
 * that the table can read just the rows it shows.
 */
import { detectDelimiter, parseRecords } from './csv';

/** What the worker is sent: a text to find the records of. */
export type RowsRequest = { id: number; text: string };
/** Where each record starts, the header's included, and the delimiter. */
export type Rows = { id: number; delimiter: string; starts: Uint32Array };

addEventListener('message', (event: MessageEvent<RowsRequest>) => {
	const { id, text } = event.data;
	const delimiter = detectDelimiter(text.slice(0, 64 * 1024)) ?? ',';
	let starts = new Uint32Array(1024);
	let count = 0;
	parseRecords(text, delimiter, true, (_, start) => {
		if (count === starts.length) {
			const grown = new Uint32Array(starts.length * 2);
			grown.set(starts);
			starts = grown;
		}
		starts[count++] = start;
	});
	const found = starts.slice(0, count);
	postMessage({ id, delimiter, starts: found } satisfies Rows, { transfer: [found.buffer] });
});
