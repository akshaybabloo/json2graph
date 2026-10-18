import { describe, expect, it } from 'vitest';
import { readShareHash, shareHash, type Shared } from './share';

const doc: Shared = {
	text: '{"name": "Ada Lovelace", "née": "Byron", "emoji": "🧮"}',
	name: 'people.json',
	type: null
};

describe('share links', () => {
	it('carry a document there and back', () => {
		const hash = shareHash(doc);
		expect(hash).toMatch(/^#[\w=&.%-]+$/);
		expect(readShareHash(hash)).toEqual(doc);
	});

	it('carry the type chosen, and a document with no name', () => {
		const typed: Shared = { text: 'a: 1', name: null, type: 'yaml' };
		expect(readShareHash(shareHash(typed))).toEqual(typed);
	});

	it('carry a long document in fewer characters', () => {
		const text = JSON.stringify(Array.from({ length: 2000 }, (_, id) => ({ id, ok: true })));
		const hash = shareHash({ ...doc, text });
		expect(hash.length).toBeLessThan(text.length / 4);
		expect(readShareHash(hash)?.text).toBe(text);
	});

	it('are not read from a hash that carries no document', () => {
		expect(readShareHash('')).toBeNull();
		expect(readShareHash('#graph')).toBeNull();
	});

	it('say when the document cannot be read back', () => {
		const hash = shareHash({ ...doc, text: 'x'.repeat(10_000) + Math.random() });
		expect(() => readShareHash(hash.slice(0, -10))).toThrow(/incomplete or damaged/);
		expect(() => readShareHash('#d=not*base64')).toThrow(/incomplete or damaged/);
	});
});
