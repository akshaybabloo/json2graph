/** What search engines and link previews are told about the site. */
export const SITE = {
	name: 'json2graph',
	title: 'json2graph: view JSON as a graph',
	description:
		'View any JSON document as a graph of boxes and arrows, in the browser. It stays fast on files of 100 MB and more, and nothing is uploaded.',
	/**
	 * Where the site is published, without a trailing slash: `VITE_SITE_URL`
	 * at build time. Tags that need an absolute address (the canonical link
	 * and the preview image) are left out when it is not set.
	 */
	url: ((import.meta.env.VITE_SITE_URL as string | undefined) ?? '').replace(/\/+$/, '')
};
