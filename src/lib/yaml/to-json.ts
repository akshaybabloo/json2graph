/**
 * YAML, as the graph shows it: the engine indexes JSON, so a YAML document is
 * read with js-yaml and written out as the JSON of its values.
 */
import {
	CORE_SCHEMA,
	defineScalarTag,
	floatCoreTag,
	intCoreTag,
	loadAll,
	mergeTag,
	NOT_RESOLVED,
	realMapTag,
	seqTag,
	strTag,
	YAMLException,
	type ScalarTagDefinition,
	type TagDefinition
} from 'js-yaml';

/** How deeply a document may nest. */
const MAX_DEPTH = 1000;
/**
 * How much longer than the YAML its JSON may be, and by how much more: an
 * alias repeats what it refers to, so a few lines can stand for gigabytes.
 */
const GROWTH = 16;
const SLACK = 64 * 1024 * 1024;

/** A number, with how it was written. */
class YamlNumber {
	readonly text: string;
	readonly value: number;

	constructor(text: string, value: number) {
		this.text = text;
		this.value = value;
	}
}

/** A number as JSON writes it: how YAML wrote it, unless JSON would not have it so. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Reads numbers as `tag` does, but keeps how they were written: large integers keep every digit. */
function spelt(tag: ScalarTagDefinition<number>) {
	return defineScalarTag<YamlNumber>(tag.tagName, {
		implicit: tag.implicit,
		implicitFirstChars: tag.implicitFirstChars,
		resolve: (source, explicit, name) => {
			const value = tag.resolve(source, explicit, name);
			return value === NOT_RESOLVED ? value : new YamlNumber(source.trim(), value);
		},
		identify: () => false
	});
}

/**
 * Tags that `tag` stands in for: the tags whose names start with `prefix`,
 * read as if they were not there.
 */
function untagged<T extends TagDefinition>(tag: T, prefix: string): T {
	return { ...tag, tagName: prefix, matchByTagPrefix: true };
}

/**
 * The tags of YAML's core schema, with merge keys and keys of any kind. Tags
 * it does not know, such as CloudFormation's `!Ref` or YAML 1.1's `!!binary`,
 * are read as if they were not there.
 */
const SCHEMA = CORE_SCHEMA.withTags(
	mergeTag,
	realMapTag,
	spelt(intCoreTag),
	spelt(floatCoreTag),
	['!', 'tag:'].flatMap((prefix) => [
		untagged(strTag, prefix),
		untagged(seqTag, prefix),
		untagged(realMapTag, prefix)
	])
);

/**
 * The JSON of the values in YAML `text`: of its one document, or an array of
 * its documents when it has several, or null when it has none. A number
 * keeps how it was written when JSON has it so, and one that JSON has no way
 * to write, such as `.inf`, becomes a string. A key that is not a string
 * becomes the text of its value.
 *
 * Throws when the text is not YAML, with where the mistake is.
 */
export function yamlToJson(text: string): string {
	let documents: unknown[];
	try {
		documents = loadAll(text, {
			schema: SCHEMA,
			// It counts the document as a level.
			maxDepth: MAX_DEPTH + 1,
			// Merging copies keys: no more of them than the text has characters.
			maxTotalMergeKeys: Math.max(10_000, text.length)
		});
	} catch (error) {
		if (!(error instanceof YAMLException)) throw error;
		if (/^nesting exceeded maxDepth/i.test(error.reason)) {
			throw new Error(`The document is nested more than ${MAX_DEPTH} levels deep`, {
				cause: error
			});
		}
		const where = error.mark
			? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
			: '';
		throw new Error(`${error.reason[0].toUpperCase()}${error.reason.slice(1)}${where}`, {
			cause: error
		});
	}
	const root = documents.length > 1 ? documents : (documents[0] ?? null);
	const room = GROWTH * text.length + SLACK;
	// Each value takes at least a character, so too many is too much, found
	// without writing any of it.
	if (countValues(root, new Map(), new Set()) > room) throw tooMuch();
	const writer = new JsonWriter(room);
	writer.write(root);
	return writer.text();
}

function tooMuch(): Error {
	return new Error('The aliases in the document repeat too much of it');
}

/**
 * How many values `value` is in JSON, itself and those it holds, with what
 * aliases repeat counted each time. What an alias refers to is the same
 * collection wherever it appears, so it is counted once, in `counts`; `open`
 * holds the collections being counted, which an alias inside them cannot
 * refer to.
 */
function countValues(value: unknown, counts: Map<object, number>, open: Set<object>): number {
	if (!Array.isArray(value) && !(value instanceof Map)) return 1;
	const known = counts.get(value);
	if (known !== undefined) return known;
	if (open.has(value)) throw new Error('An alias refers to a value that holds it');
	open.add(value);
	let count = 1;
	if (Array.isArray(value)) {
		for (const item of value) count += countValues(item, counts, open);
	} else {
		for (const [key, item] of value) {
			count += countValues(key, counts, open) + countValues(item, counts, open);
		}
	}
	open.delete(value);
	counts.set(value, count);
	return count;
}

class JsonWriter {
	#parts: string[] = [];
	#room: number;

	constructor(room: number) {
		this.#room = room;
	}

	#push(part: string) {
		this.#room -= part.length;
		if (this.#room < 0) throw tooMuch();
		this.#parts.push(part);
	}

	/** What has been written. */
	text(): string {
		return this.#parts.join('');
	}

	write(value: unknown) {
		if (value instanceof YamlNumber) {
			const { text, value: number } = value;
			if (JSON_NUMBER.test(text)) this.#push(text);
			else if (Number.isFinite(number)) this.#push(String(number));
			else this.#push(JSON.stringify(String(number)));
		} else if (value === null || value === undefined) {
			this.#push('null');
		} else if (typeof value === 'string') {
			this.#push(JSON.stringify(value));
		} else if (typeof value !== 'object') {
			this.#push(String(value));
		} else if (Array.isArray(value)) {
			this.#items(value);
		} else if (value instanceof Map) {
			this.#pairs(value);
		} else {
			this.#push(JSON.stringify(String(value)));
		}
	}

	#items(items: unknown[]) {
		this.#push('[');
		items.forEach((item, index) => {
			if (index > 0) this.#push(',');
			this.write(item);
		});
		this.#push(']');
	}

	#pairs(map: Map<unknown, unknown>) {
		this.#push('{');
		let first = true;
		for (const [key, value] of map) {
			if (!first) this.#push(',');
			first = false;
			this.#push(JSON.stringify(this.#keyText(key)));
			this.#push(':');
			this.write(value);
		}
		this.#push('}');
	}

	/** What a key is called in JSON, where every key is a string. */
	#keyText(key: unknown): string {
		if (typeof key === 'string') return key;
		if (key instanceof YamlNumber) return key.text;
		if (key === null || typeof key !== 'object') return String(key);
		const writer = new JsonWriter(this.#room);
		writer.write(key);
		return writer.text();
	}
}
