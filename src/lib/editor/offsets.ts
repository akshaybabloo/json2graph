/**
 * Turns places in a text between the editor's offsets, in UTF-16 code units,
 * and the graph's, in bytes of its UTF-8. Text that is all ASCII has the same
 * offsets in both; otherwise the bytes before every few thousand characters
 * are counted once, and a place is found from the nearest of those.
 */

/** How many characters apart the counts of bytes are. */
const STEP = 4096;

/** How many bytes the UTF-16 code unit `code` takes in UTF-8: a surrogate pair takes four, all in its first half. */
function bytesOf(code: number): number {
	if (code < 0x80) return 1;
	if (code < 0x800) return 2;
	if (code >= 0xd800 && code <= 0xdbff) return 4;
	if (code >= 0xdc00 && code <= 0xdfff) return 0;
	return 3;
}

export class ByteOffsets {
	#text: string;
	/** Bytes before character `i * STEP`; none when the text is all ASCII. */
	#marks: Uint32Array | null;

	constructor(text: string) {
		this.#text = text;
		this.#marks = /[\u0080-\uffff]/.test(text) ? this.#count() : null;
	}

	#count(): Uint32Array {
		const marks = new Uint32Array(Math.floor(this.#text.length / STEP) + 1);
		let bytes = 0;
		for (let i = 0; i < this.#text.length; i++) {
			if (i % STEP === 0) marks[i / STEP] = bytes;
			bytes += bytesOf(this.#text.charCodeAt(i));
		}
		// The end of a text whose length is a whole number of steps.
		if (this.#text.length % STEP === 0) marks[marks.length - 1] = bytes;
		return marks;
	}

	/** The byte offset of character offset `char`. */
	toByte(char: number): number {
		const marks = this.#marks;
		if (!marks) return char;
		const mark = Math.floor(char / STEP);
		let bytes = marks[mark];
		for (let i = mark * STEP; i < char; i++) bytes += bytesOf(this.#text.charCodeAt(i));
		return bytes;
	}

	/**
	 * The character offset of byte offset `byte`; inside a character that
	 * takes more than one byte, the offset of that character.
	 */
	toChar(byte: number): number {
		const marks = this.#marks;
		if (!marks) return byte;
		// The last mark at or before the byte.
		let low = 0;
		let high = marks.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (marks[mid] <= byte) low = mid + 1;
			else high = mid;
		}
		let char = Math.max(low - 1, 0) * STEP;
		let bytes = marks[Math.max(low - 1, 0)];
		while (char < this.#text.length) {
			const next = bytes + bytesOf(this.#text.charCodeAt(char));
			if (next > byte) break;
			bytes = next;
			char += 1;
		}
		return char;
	}
}
