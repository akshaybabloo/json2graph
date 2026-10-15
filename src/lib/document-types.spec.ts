import { describe, expect, it } from 'vitest';
import { contentBlob, DEFAULT_TYPE, detect, documentType, typeOfName } from './document-types';

describe('detect', () => {
	it('goes by the extension of the name of the file first', () => {
		expect(typeOfName('Data.JSON')?.id).toBe('json');
		expect(typeOfName('archive.tar')).toBeNull();
		expect(typeOfName('no-extension')).toBeNull();
		expect(typeOfName(null)).toBeNull();
		expect(detect('orders.json', 'not json at all').id).toBe('json');
	});

	it('looks at the text when the name says nothing', () => {
		expect(detect(null, '  \n{"a": 1}').id).toBe('json');
		expect(detect('untitled', '[1, 2]').id).toBe('json');
	});

	it('takes a table for CSV', () => {
		expect(detect('people.csv', '{').id).toBe('csv');
		expect(detect(null, 'name,age\nAda,36\n').id).toBe('csv');
		expect(detect(null, '[\n1,2,\n3,4\n]').id).toBe('json');
		expect(detect(null, 'just a line, of words').id).toBe('json');
	});

	it('falls back on the default type', () => {
		expect(detect(null, '')).toBe(DEFAULT_TYPE);
		expect(documentType('no such type')).toBe(DEFAULT_TYPE);
	});
});

describe('contentBlob', () => {
	it('gives text the media type of its type', () => {
		expect(contentBlob('{}', documentType('json')).type).toBe('application/json');
	});

	it('keeps a blob that already has it', () => {
		const blob = new Blob(['{}'], { type: 'application/json' });
		expect(contentBlob(blob, documentType('json'))).toBe(blob);
		expect(contentBlob(new Blob(['{}']), documentType('json')).type).toBe('application/json');
	});
});
