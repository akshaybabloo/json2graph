import { describe, expect, it } from 'vitest';
import { ByteOffsets } from './offsets';

const encoder = new TextEncoder();
/** The bytes of the UTF-8 of the first `char` characters, counted the slow way. */
const bytesBefore = (text: string, char: number) => encoder.encode(text.slice(0, char)).length;

describe('ByteOffsets', () => {
	it('takes the offsets of ASCII to be the same in both', () => {
		const offsets = new ByteOffsets('{"a": 1}');
		expect(offsets.toByte(5)).toBe(5);
		expect(offsets.toChar(5)).toBe(5);
	});

	it('counts the bytes of characters of two, three and four bytes', () => {
		const text = '{"ü": "✓ 😀", "n": 1}';
		const offsets = new ByteOffsets(text);
		for (let char = 0; char <= text.length; char++) {
			// Not between the halves of a surrogate pair, which is no place in UTF-8.
			if (text.charCodeAt(char - 1) >= 0xd800 && text.charCodeAt(char - 1) <= 0xdbff) continue;
			const byte = bytesBefore(text, char);
			expect(offsets.toByte(char)).toBe(byte);
			expect(offsets.toChar(byte)).toBe(char);
		}
		// Inside a character, its start.
		expect(offsets.toChar(bytesBefore(text, 7) + 1)).toBe(7);
	});

	it('finds places far into a long text', () => {
		const text = ('ab✓ü😀\n'.repeat(5000) + '"end"').repeat(2);
		const offsets = new ByteOffsets(text);
		for (const char of [0, 4095, 4096, 4097, 20_001, text.length - 3, text.length]) {
			const byte = bytesBefore(text, char);
			expect(offsets.toByte(char)).toBe(byte);
			expect(offsets.toChar(byte)).toBe(char);
		}
	});

	it('finds the end of a text that is a whole number of steps long', () => {
		const text = 'ü'.repeat(8192);
		const offsets = new ByteOffsets(text);
		expect(offsets.toByte(text.length)).toBe(16384);
		expect(offsets.toChar(16384)).toBe(text.length);
	});
});
