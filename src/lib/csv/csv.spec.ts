import { describe, expect, it } from 'vitest';
import { columnNames, detectDelimiter, looksLikeCsv, parseRecord, parseRecords } from './csv';

function records(text: string, delimiter = ',') {
	const found: [string[], number][] = [];
	parseRecords(text, delimiter, true, (fields, start) => found.push([fields, start]));
	return found;
}

describe('parseRecords', () => {
	it('splits records at any line break, and skips blank lines', () => {
		expect(records('a,b\n1,2\r\n3,4\r5,6\n\n7,8\n')).toEqual([
			[['a', 'b'], 0],
			[['1', '2'], 4],
			[['3', '4'], 9],
			[['5', '6'], 13],
			[['7', '8'], 18]
		]);
	});

	it('reads quoted fields, with delimiters, line breaks and doubled quotes in them', () => {
		expect(records('"a,b","say ""hi""","two\nlines"\n')).toEqual([
			[['a,b', 'say "hi"', 'two\nlines'], 0]
		]);
	});

	it('keeps empty fields, and a last field after a trailing delimiter', () => {
		expect(records('a,,c,\n,')).toEqual([
			[['a', '', 'c', ''], 0],
			[['', ''], 6]
		]);
	});

	it('takes a record without a line break at the end of the text', () => {
		expect(records('a;b', ';')).toEqual([[['a', 'b'], 0]]);
	});

	it('leaves a record that may go on for the next chunk', () => {
		const seen: string[][] = [];
		const onRecord = (fields: string[]) => seen.push(fields);
		expect(parseRecords('a,b\n1,"x\n', ',', false, onRecord)).toBe(4);
		expect(parseRecords('a,b\n1,2', ',', false, onRecord)).toBe(4);
		// A quote at the end might be doubled by the next chunk.
		expect(parseRecords('1,"x"', ',', false, onRecord)).toBe(0);
		// A carriage return at the end might be followed by a line feed.
		expect(parseRecords('1,2\r', ',', false, onRecord)).toBe(0);
		expect(seen).toEqual([
			['a', 'b'],
			['a', 'b']
		]);
	});

	it('reads a text split anywhere into two chunks the same as in one', () => {
		const text = 'a,"b ""q"", c"\r\n"x\ny",,z\r\r\n1,2\n"end"';
		const whole = records(text).map(([fields]) => fields);
		for (let split = 0; split <= text.length; split++) {
			const seen: string[][] = [];
			const onRecord = (fields: string[]) => seen.push(fields);
			const used = parseRecords(text.slice(0, split), ',', false, onRecord);
			parseRecords(text.slice(used), ',', true, onRecord);
			expect(seen, `split at ${split}`).toEqual(whole);
		}
	});

	it('reads one record', () => {
		expect(parseRecord('"x",y\n', ',')).toEqual(['x', 'y']);
	});
});

describe('detectDelimiter', () => {
	it('finds the delimiter the lines agree on', () => {
		expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
		expect(detectDelimiter('a;b\n1,5;2\n3;4')).toBe(';');
		expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
		expect(detectDelimiter('just words')).toBeNull();
	});

	it('takes text for a table only when two lines agree', () => {
		expect(looksLikeCsv('name,age\nAda,36')).toBe(true);
		expect(looksLikeCsv('Hello, world')).toBe(false);
		expect(looksLikeCsv('{"a": 1, "b": 2}\n')).toBe(false);
	});
});

describe('columnNames', () => {
	it('names blank columns after their place', () => {
		expect(columnNames(['id', '', 'id', ' '])).toEqual(['id', 'column 2', 'id', 'column 4']);
	});
});
