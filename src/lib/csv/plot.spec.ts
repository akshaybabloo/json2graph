import type { Data } from 'plotly.js';
import { describe, expect, it } from 'vitest';
import { readColumns } from './columns';
import { acrossName, traces } from './plot';

/** What a trace is plotted across. */
const across = (trace: Data) => Array.from((trace as { x: ArrayLike<number> }).x);

const table = readColumns('year,rain,city\n2001,3,Pune\n2002,5,Delhi\n', ',');

describe('traces', () => {
	it('plots each column chosen up against the one chosen across', () => {
		const [trace] = traces(table, { chart: 'line', x: 0, y: [1] });
		expect(trace).toMatchObject({ type: 'scatter', mode: 'lines', name: 'rain' });
		expect(across(trace)).toEqual([2001, 2002]);
		expect(acrossName(table.columns, { chart: 'line', x: 2, y: [1] })).toBe('city');
	});

	it('leaves out columns the table no longer has, and plots across the rows when that one is gone', () => {
		const choice = { chart: 'bar', x: 5, y: [1, 2, 7] } as const;
		const plotted = traces(table, { ...choice, y: [...choice.y] });
		expect(plotted.map((trace) => trace.name)).toEqual(['rain']);
		expect(across(plotted[0])).toEqual([1, 2]);
		expect(acrossName(table.columns, { ...choice, y: [] })).toBe('Row');
	});
});
