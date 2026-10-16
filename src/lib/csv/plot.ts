/**
 * Plots the columns of a CSV with Plotly. Plotly is large, so it is fetched
 * only when the first plot is drawn.
 */
import type { Data } from 'plotly.js';
import { isPlottable, type Column, type Columns, type Kind } from './columns';

type Plotly = typeof import('plotly.js').default;

/** How the values are drawn: joined by lines, as points, or as bars. */
export type Chart = 'line' | 'scatter' | 'bar';

/**
 * What is plotted: the kind of chart, the column across (none for the
 * number of the row) and the columns of numbers up, by their places.
 */
export type PlotChoice = { chart: Chart; x: number | null; y: number[] };

let loaded: Promise<Plotly> | undefined;

export function plotly(): Promise<Plotly> {
	// Built by Plotly, as its own source needs Node's globals to run.
	loaded ??= import('plotly.js/dist/plotly-basic.min.js').then(
		(module) => module.default,
		(error) => {
			// Fetched again the next time, rather than keep the failure.
			loaded = undefined;
			throw new Error('The plotting library could not be loaded', { cause: error });
		}
	);
	return loaded;
}

/**
 * A plot of the columns among `y` that can be plotted, by their places. Across goes
 * the table's first column when that names the rows, as text such as dates or
 * as numbers that only go up, such as years or ids; otherwise the number of
 * the row.
 */
export function choosePlot(kinds: Kind[], y: number[]): PlotChoice {
	const plotted = y.filter((place) => isPlottable(kinds[place]));
	const first = kinds[0];
	const x = (first === 'text' || first === 'increasing') && !plotted.includes(0) ? 0 : null;
	return { chart: 'line', x, y: plotted };
}

/** The most columns plotted when none were chosen. */
const FIRST_PLOTTED = 5;

/**
 * A plot of a table none of whose columns were chosen: across, its first
 * column when that names the rows, as `choosePlot` has it; up, the first few
 * of the others that can be plotted.
 */
export function firstPlot(kinds: Kind[]): PlotChoice {
	const x = kinds[0] === 'text' || kinds[0] === 'increasing' ? 0 : null;
	const y = kinds
		.flatMap((kind, place) => (isPlottable(kind) && place !== x ? [place] : []))
		.slice(0, FIRST_PLOTTED);
	return { chart: 'line', x, y };
}

/**
 * The column chosen across, when the table still has it: one taken out of
 * the text since, or gone from a plot kept with a tab, leaves the number of
 * the row.
 */
function acrossColumn(columns: Column[], choice: PlotChoice): Column | null {
	return choice.x === null ? null : (columns[choice.x] ?? null);
}

/** The name of what is across: the column, or the row. */
export function acrossName(columns: Column[], choice: PlotChoice): string {
	return acrossColumn(columns, choice)?.name ?? 'Row';
}

/**
 * The traces of the columns chosen up that the table still has as numbers,
 * each against the one chosen across.
 */
export function traces({ step, columns }: Columns, choice: PlotChoice): Data[] {
	const across = acrossColumn(columns, choice);
	const count = columns[0]?.numbers?.length ?? columns[0]?.texts?.length ?? 0;
	// The numbers of the rows, as the table has them.
	const x = across
		? (across.numbers ?? across.texts!)
		: Float64Array.from({ length: count }, (_, i) => i * step + 1);
	return choice.y.flatMap((place): Data[] => {
		const column = columns[place];
		if (!column?.numbers) return [];
		const { name, numbers } = column;
		if (choice.chart === 'bar') return [{ type: 'bar', name, x, y: numbers }];
		return [
			{ type: 'scatter', mode: choice.chart === 'line' ? 'lines' : 'markers', name, x, y: numbers }
		];
	});
}

/** A plot as it was kept with a tab, when it is one; otherwise none. */
export function keptPlot(value: unknown): PlotChoice | null {
	if (typeof value !== 'object' || value === null) return null;
	const { chart, x, y } = value as Record<string, unknown>;
	const place = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
	if (chart !== 'line' && chart !== 'scatter' && chart !== 'bar') return null;
	if (x !== null && !place(x)) return null;
	if (!Array.isArray(y) || !y.every(place)) return null;
	return { chart, x: x as number | null, y: y as number[] };
}
