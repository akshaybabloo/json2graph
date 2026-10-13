import { SITE } from '#lib/site.js';

export const prerender = true;

/** Escapes the characters that XML reserves in text. */
function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The sitemap: the one page of the site. A sitemap may only hold absolute
 * addresses, so it lists nothing until `SITE.url` is set.
 */
export function GET() {
	const pages = SITE.url ? [`${SITE.url}/`] : [];
	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...pages.map((page) => `\t<url><loc>${escape(page)}</loc></url>`),
		'</urlset>',
		''
	].join('\n');
	return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
