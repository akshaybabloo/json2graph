import { json } from '@codemirror/lang-json';
import type { Extension } from '@codemirror/state';
import sampleCsv from './assets/sample.csv?raw';
import sampleJson from './assets/sample.json?raw';
import { looksLikeCsv } from './csv/csv';
import { csvLanguage } from './csv/language';

/** A kind of document the editor holds, and what the app does with it. */
export interface DocumentType {
	id: string;
	/** What the type is called on screen. */
	label: string;
	/** The media type its content is saved with. */
	mime: string;
	/** Extensions of the names of files of this type, with the dot. */
	extensions: string[];
	/** What the editor knows of the language: highlighting, folding and the like. */
	language: () => Extension;
	/**
	 * How sure it is, from 0 to 1, that a document starting with `text` is of
	 * this type, when the name of its file does not say.
	 */
	sniff: (text: string) => number;
	/** Re-indents a document of this type, and rejects one that is not valid. None when there is no formatter. */
	format?: (text: string) => Promise<string>;
	/** A sample document of this type, with the name of its file. */
	example?: { name: string; text: string };
}

const JSON_TYPE: DocumentType = {
	id: 'json',
	label: 'JSON',
	mime: 'application/json',
	extensions: ['.json'],
	language: () => json(),
	sniff: (text) => (/^\s*[[{]/.test(text) ? 1 : 0),
	// Loaded when it is first used: nothing else needs the formatter.
	format: async (text) => (await import('./format/format')).formatJson(text),
	example: { name: 'sample.json', text: sampleJson }
};

const CSV_TYPE: DocumentType = {
	id: 'csv',
	label: 'CSV',
	mime: 'text/csv',
	extensions: ['.csv'],
	language: csvLanguage,
	// Less sure than JSON, which a brace or bracket gives away.
	sniff: (text) => (/^\s*[[{]/.test(text) ? 0 : looksLikeCsv(text) ? 0.6 : 0),
	example: { name: 'people.csv', text: sampleCsv }
};

/** Every type a document can be, in the order they are offered. */
export const DOCUMENT_TYPES: readonly DocumentType[] = [JSON_TYPE, CSV_TYPE];

/** The types that have an example to open. */
export const EXAMPLES = DOCUMENT_TYPES.filter((type) => type.example);

/** What a document is taken to be when nothing says otherwise. */
export const DEFAULT_TYPE = JSON_TYPE;

/** How much of a document `detect` looks at. */
export const SNIFF_LENGTH = 4096;

/** What the file picker offers to open. */
export const ACCEPT = DOCUMENT_TYPES.flatMap((type) => [...type.extensions, type.mime]).join(',');

export function documentType(id: string): DocumentType {
	return DOCUMENT_TYPES.find((type) => type.id === id) ?? DEFAULT_TYPE;
}

/** The type that the extension of a file's name says, if it says one. */
export function typeOfName(name: string | null): DocumentType | null {
	const extension = name?.toLowerCase().match(/\.[^./]+$/)?.[0];
	if (!extension) return null;
	return DOCUMENT_TYPES.find((type) => type.extensions.includes(extension)) ?? null;
}

/**
 * The type a document is: what the name of its file says, or else what its
 * first characters look most like.
 */
export function detect(name: string | null, text: string): DocumentType {
	const named = typeOfName(name);
	if (named) return named;
	const start = text.slice(0, SNIFF_LENGTH);
	let best = DEFAULT_TYPE;
	let sureness = 0;
	for (const type of DOCUMENT_TYPES) {
		const score = type.sniff(start);
		if (score > sureness) {
			best = type;
			sureness = score;
		}
	}
	return best;
}

/** Content as it is saved and indexed: a blob of the type's media type. A file is not copied. */
export function contentBlob(content: string | Blob, type: DocumentType): Blob {
	if (content instanceof Blob && content.type === type.mime) return content;
	return new Blob([content], { type: type.mime });
}
