import { deflateRaw, inflateRaw } from 'pako';

/** Above this many characters, a link may be cut short when it is pasted into chat or email. */
export const SHARE_WARN = 8 * 1024;
/** The longest link that Chrome opens. */
export const SHARE_MAX = 2 * 1024 * 1024;
/**
 * Above this many characters, a document is not compressed to find out: not
 * even the most repetitive text would shrink into a link that opens.
 */
export const SHARE_TEXT_MAX = 32 * SHARE_MAX;

/** A document as a link carries it. */
export type Shared = {
	text: string;
	/** Name of the file it was opened from; none for a document that was typed. */
	name: string | null;
	/** Id of the type that was chosen for it; none for one that is detected. */
	type: string | null;
};

/**
 * The hash of a link that carries the document: its text compressed, in
 * base64url, with its name and type. The hash never reaches the server.
 */
export function shareHash({ text, name, type }: Shared): string {
	const params = new URLSearchParams();
	if (name !== null) params.set('n', name);
	if (type !== null) params.set('t', type);
	params.set('d', toBase64Url(deflateRaw(text, { level: 9 })));
	return `#${params}`;
}

/**
 * The document that a link's hash carries; none for a hash that carries
 * none, such as that of a link within the page.
 *
 * @throws When the document cannot be read back: the link was cut short or changed.
 */
export function readShareHash(hash: string): Shared | null {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const doc = params.get('d');
	if (doc === null) return null;
	let text: string;
	try {
		text = inflateRaw(fromBase64Url(doc), { toText: true });
	} catch {
		throw new Error('The link is incomplete or damaged, so its document cannot be read');
	}
	return { text, name: params.get('n'), type: params.get('t') };
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	// In pieces, as a call takes only so many arguments.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
