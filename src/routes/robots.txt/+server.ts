import { SITE } from '#lib/site.js';

export const prerender = true;

/** Everything may be crawled; the sitemap is named once the site's address is known. */
export function GET() {
	const lines = ['User-agent: *', 'Disallow:'];
	if (SITE.url) lines.push('', `Sitemap: ${SITE.url}/sitemap.xml`);
	return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain' } });
}
