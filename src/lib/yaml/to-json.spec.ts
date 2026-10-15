import { describe, expect, it } from 'vitest';
import { yamlToJson } from './to-json';

const values = (text: string) => JSON.parse(yamlToJson(text));

describe('yamlToJson', () => {
	it('gives the values of a document', () => {
		expect(values('name: Ada\nage: 36\ntags: [a, b]\nnext: ~\nok: true\n')).toEqual({
			name: 'Ada',
			age: 36,
			tags: ['a', 'b'],
			next: null,
			ok: true
		});
	});

	it('keeps the order of the keys', () => {
		expect(yamlToJson('b: 1\na: 2\n')).toBe('{"b":1,"a":2}');
	});

	it('reads block scalars, anchors and merge keys', () => {
		const text = 'base: &base\n  x: 1\nchild:\n  <<: *base\n  y: 2\ntext: |\n  one\n  two\n';
		expect(values(text)).toEqual({
			base: { x: 1 },
			child: { x: 1, y: 2 },
			text: 'one\ntwo\n'
		});
	});

	it('keeps how a number is written when JSON writes it so', () => {
		expect(yamlToJson('[12345678901234567890, 1.0, 1.5e3, -0]')).toBe(
			'[12345678901234567890,1.0,1.5e3,-0]'
		);
		expect(yamlToJson('[0x1F, 0o17, +12, 007]')).toBe('[31,15,12,7]');
	});

	it('writes what JSON cannot as strings', () => {
		expect(yamlToJson('[.inf, -.inf, .nan]')).toBe('["Infinity","-Infinity","NaN"]');
		expect(yamlToJson('1: a\n1.50: b\n? [x, y]\n: c\n~: d\n')).toBe(
			'{"1":"a","1.50":"b","[\\"x\\",\\"y\\"]":"c","null":"d"}'
		);
	});

	it('reads the tags of other tools as if they were not there', () => {
		const text = 'a: !Ref Bucket\nb: !GetAtt [Bucket, Arn]\nc: !If {x: 1}\nd: !!binary aGk=\n';
		expect(values(text)).toEqual({ a: 'Bucket', b: ['Bucket', 'Arn'], c: { x: 1 }, d: 'aGk=' });
	});

	it('makes an array of several documents', () => {
		expect(values('a: 1\n---\nb: 2\n')).toEqual([{ a: 1 }, { b: 2 }]);
		expect(values('a: 1\n')).toEqual({ a: 1 });
		expect(values('# nothing but a comment\n')).toBeNull();
	});

	it('says where the mistake is', () => {
		expect(() => yamlToJson('a:\n  b: c: d\n')).toThrow(/^Bad indentation .* at line 2, column 7$/);
		expect(() => yamlToJson('a: 1\na: 2\n')).toThrow('Duplicated mapping key at line 2, column 1');
	});

	it('refuses aliases that repeat too much, or hold themselves', () => {
		const lines = ['a: &a [x, x, x, x, x, x, x, x, x, x]'];
		for (let i = 1; i < 10; i++) {
			const name = String.fromCharCode(97 + i);
			const previous = String.fromCharCode(96 + i);
			lines.push(`${name}: &${name} [${Array(10).fill(`*${previous}`).join(', ')}]`);
		}
		expect(() => yamlToJson(lines.join('\n'))).toThrow(
			'The aliases in the document repeat too much of it'
		);
		expect(() => yamlToJson('&a [*a]')).toThrow('An alias refers to a value that holds it');
	});

	it('refuses nesting too deep', () => {
		expect(values('['.repeat(1000) + ']'.repeat(1000))).toHaveLength(1);
		expect(() => yamlToJson('['.repeat(1001) + ']'.repeat(1001))).toThrow(
			'The document is nested more than 1000 levels deep'
		);
	});
});
