/**
 * Reads the columns of a CSV text for a plot: which of them hold numbers, and
 * the values of the rows that are plotted.
 */
import { columnNames, parseRecords } from './csv';

/**
 * The most rows that are plotted. A plot of more draws slowly, and shows no
 * more than the screen has pixels for: past this, rows are taken at an even
 * step through the table.
 */
export const MAX_PLOTTED = 10_000;

/** A number as a field of a CSV holds it: decimal, with a sign and an exponent if any. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN = /^(?:true|false)$/i;
/** A field with no value: empty, or null as JSON would have it. */
const NULL = /^(?:|null)$/i;

/**
 * What a column holds, in every row: nothing, text, true or false, numbers,
 * or numbers that only go up, such as years or ids. A column of numbers or
 * of true or false may have fields with no value.
 */
export type Kind = 'empty' | 'text' | 'boolean' | 'numbers' | 'increasing';

/**
 * True and false as they are plotted, and a field with no value among them:
 * a level of its own, below false.
 */
export const BOOLEAN_LEVELS = { true: 1, false: 0, null: -1 } as const;

/** Tells what each column holds, from its fields, row by row. */
export class ColumnKinds {
	#kinds: Kind[] = [];
	#last: number[] = [];

	/** Takes the fields of the next row. */
	add(fields: string[]) {
		for (let column = 0; column < fields.length; column++) {
			const kind = this.#kinds[column] ?? 'empty';
			if (kind === 'text') continue;
			const field = fields[column].trim();
			if (NULL.test(field)) {
				// A gap: what goes up must go up past it, and not around it.
				if (kind === 'increasing') this.#kinds[column] = 'numbers';
				continue;
			}
			if (BOOLEAN.test(field)) {
				this.#kinds[column] = kind === 'empty' || kind === 'boolean' ? 'boolean' : 'text';
				continue;
			}
			if (kind === 'boolean' || !NUMBER.test(field)) {
				this.#kinds[column] = 'text';
				continue;
			}
			const number = Number(field);
			if (kind === 'empty') this.#kinds[column] = 'increasing';
			else if (kind === 'increasing' && !(number > this.#last[column])) {
				this.#kinds[column] = 'numbers';
			}
			this.#last[column] = number;
		}
	}

	/** What each of `count` columns holds. */
	kinds(count: number): Kind[] {
		return Array.from({ length: count }, (_, column) => this.#kinds[column] ?? 'empty');
	}
}

/** Whether a column that holds `kind` can be plotted. */
export function isPlottable(kind: Kind | undefined): boolean {
	return kind === 'numbers' || kind === 'increasing' || kind === 'boolean';
}

/** A field of a column of `kind` as it is plotted: NaN, a gap, where it has no value. */
function plotValue(field: string, kind: Kind): number {
	if (kind === 'boolean') {
		if (NULL.test(field)) return BOOLEAN_LEVELS.null;
		return field.toLowerCase() === 'true' ? BOOLEAN_LEVELS.true : BOOLEAN_LEVELS.false;
	}
	return NULL.test(field) ? NaN : Number(field);
}

/** A column, with its fields in the rows that are plotted. */
export type Column = {
	name: string;
	kind: Kind;
	/**
	 * The fields as they are plotted, for a column of numbers or of true or
	 * false; otherwise none.
	 */
	numbers: Float64Array | null;
	/** The fields as text, for a column that is not plotted. */
	texts: string[] | null;
};

export type Columns = {
	/** How many rows of data the table has: the records after the header. */
	rows: number;
	/** Every `step`th row is plotted, from the first. */
	step: number;
	columns: Column[];
};

/** The columns of the CSV `text`, whose fields are separated by `delimiter`. */
export function readColumns(text: string, delimiter: string, most = MAX_PLOTTED): Columns {
	let names: string[] | null = null;
	const kinds = new ColumnKinds();
	let plotted: string[][] = [];
	let step = 1;
	let rows = 0;

	parseRecords(text, delimiter, true, (fields) => {
		if (names === null) {
			names = columnNames(fields);
			return;
		}
		kinds.add(fields);
		if (rows % step === 0) {
			plotted.push(fields);
			if (plotted.length > most) {
				// Every other row of those taken, which is every row at twice the step.
				plotted = plotted.filter((_, i) => i % 2 === 0);
				step *= 2;
			}
		}
		rows++;
	});

	const header: string[] = names ?? [];
	const kindOf = kinds.kinds(header.length);
	const columns = header.map((name, column): Column => {
		const kind = kindOf[column];
		const fields = plotted.map((record) => record[column]?.trim() ?? '');
		if (isPlottable(kind)) {
			const numbers = Float64Array.from(fields, (field) => plotValue(field, kind));
			return { name, kind, numbers, texts: null };
		}
		return { name, kind, numbers: null, texts: fields };
	});
	return { rows, step, columns };
}
