import { describe, expect, it } from 'vitest';
import { ColumnKinds, readColumns } from './columns';

describe('readColumns', () => {
	it('reads a column whose fields are all numbers as numbers, and the rest as text', () => {
		const { rows, step, columns } = readColumns(
			'year,city,people\n2001,Pune,3.1e6\n2002,Mumbai,-12.5\n2003,Delhi,.5\n',
			','
		);
		expect(rows).toBe(3);
		expect(step).toBe(1);
		expect(columns.map((column) => column.name)).toEqual(['year', 'city', 'people']);
		expect(Array.from(columns[0].numbers!)).toEqual([2001, 2002, 2003]);
		expect(Array.from(columns[2].numbers!)).toEqual([3.1e6, -12.5, 0.5]);
		expect(columns[1]).toEqual({
			name: 'city',
			kind: 'text',
			numbers: null,
			texts: ['Pune', 'Mumbai', 'Delhi']
		});
	});

	it('takes an empty field as a gap in a column of numbers', () => {
		const { columns } = readColumns('a;b\n1;\n;2\n3; 4 \n', ';');
		expect(Array.from(columns[0].numbers!)).toEqual([1, NaN, 3]);
		expect(Array.from(columns[1].numbers!)).toEqual([NaN, 2, 4]);
	});

	it('plots true as 1 and false as 0, with no value below them at -1', () => {
		const { columns } = readColumns('active,n\ntrue,1\nFALSE,2\nnull,3\n,4\nTrue,5\n', ',');
		expect(columns[0].kind).toBe('boolean');
		expect(Array.from(columns[0].numbers!)).toEqual([1, 0, -1, -1, 1]);
	});

	it('takes null as a gap in a column of numbers', () => {
		const { columns } = readColumns('n\n1\nnull\n3\n', ',');
		expect(Array.from(columns[0].numbers!)).toEqual([1, NaN, 3]);
	});

	it('takes no column with a field that is not a number, or with none at all, as numbers', () => {
		const { columns } = readColumns('a,b,c\n1,1,\n2,1 000,\nn/a,0x10,\n', ',');
		expect(columns.map((column) => column.numbers)).toEqual([null, null, null]);
	});

	it('takes rows at an even step when there are more than are plotted', () => {
		const text = 'n\n' + Array.from({ length: 1000 }, (_, i) => i).join('\n');
		const { rows, step, columns } = readColumns(text, ',', 300);
		expect(rows).toBe(1000);
		expect(step).toBe(4);
		expect(Array.from(columns[0].numbers!)).toEqual(Array.from({ length: 250 }, (_, i) => i * 4));
	});

	it('names a column with no name after its place', () => {
		expect(readColumns(',b\n1,2\n', ',').columns[0].name).toBe('column 1');
	});
});

describe('ColumnKinds', () => {
	function kinds(rows: string[][]) {
		const kinds = new ColumnKinds();
		rows.forEach((fields) => kinds.add(fields));
		return kinds.kinds(rows[0].length);
	}

	it('tells numbers that only go up from other numbers, text, and nothing', () => {
		expect(
			kinds([
				['1', '5', 'a', ''],
				['2', '3', '1', ''],
				['10', '4', '2', '']
			])
		).toEqual(['increasing', 'numbers', 'text', 'empty']);
	});

	it('takes numbers that stay the same, or have a gap, as not going up', () => {
		expect(
			kinds([
				['1', '1'],
				['1', ''],
				['2', '3']
			])
		).toEqual(['numbers', 'numbers']);
	});

	it('takes true or false mixed with numbers or text as text', () => {
		expect(
			kinds([
				['true', '1', 'true'],
				['false', 'true', 'yes'],
				['null', '', 'false']
			])
		).toEqual(['boolean', 'text', 'text']);
	});
});
