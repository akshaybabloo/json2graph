/**
 * Reads the columns of a CSV text for a plot, off the page's thread: every
 * row is read to tell which columns hold numbers.
 */
import { readColumns, type Columns } from './columns';
import { detectDelimiter } from './csv';

/** What the worker is sent: a text to read the columns of. */
export type ColumnsRequest = { id: number; text: string };
/** The columns of the text with the same id. */
export type ColumnsReply = Columns & { id: number };

addEventListener('message', (event: MessageEvent<ColumnsRequest>) => {
	const { id, text } = event.data;
	const delimiter = detectDelimiter(text.slice(0, 64 * 1024)) ?? ',';
	const columns = readColumns(text, delimiter);
	const transfer = columns.columns.flatMap((column) =>
		column.numbers ? [column.numbers.buffer] : []
	);
	postMessage({ id, ...columns } satisfies ColumnsReply, { transfer });
});
