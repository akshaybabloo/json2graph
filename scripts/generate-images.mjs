// Draws the PNGs in static/ from the logo: the app icons and the preview image
// that link previews show. Run it again after changing the logo or the wording.
//
//   node scripts/generate-images.mjs
//
// It needs a Chromium that Playwright can start, or an installed Chrome.

import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url);
const out = (name) => fileURLToPath(new URL(`static/${name}`, root));
const inter = new URL(
	'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
	root
);

const BLUE = '#2457d6';
const INK = '#171717';

// The logo, as in src/lib/components/logo.svelte.
const logo = (ink, node) => `
	<svg viewBox="0 0 48 48" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
		<path d="M9.5 5c-2.7 0-4 1.3-4 4v9.5c0 3-1.2 5.5-3.5 5.5 2.3 0 3.5 2.5 3.5 5.5V39c0 2.7 1.3 4 4 4"/>
		<path d="M38.5 5c2.7 0 4 1.3 4 4v9.5c0 3 1.2 5.5 3.5 5.5-2.3 0-3.5 2.5-3.5 5.5V39c0 2.7-1.3 4-4 4"/>
		<path d="M28 14h-1.5c-2.2 0-3.2 1-3.2 3.2v3.3c0 2-1.1 3.5-3.3 3.5 2.2 0 3.3 1.5 3.3 3.5v3.3c0 2.2 1 3.2 3.2 3.2H28"/>
		<g fill="${node}" stroke="none">
			<rect x="10.5" y="20" width="8" height="8" rx="2.4"/>
			<rect x="28.5" y="10" width="8" height="8" rx="2.4"/>
			<rect x="28.5" y="30" width="8" height="8" rx="2.4"/>
		</g>
	</svg>`;

/**
 * An app icon: the logo in its own colours on white. The background is solid
 * because a home screen turns a transparent one black, and the logo stays in
 * the middle of the square, which is all that a round icon keeps.
 */
const icon = `
	<body style="margin: 0; height: 100vh; display: grid; place-items: center; background: #ffffff">
		<div style="width: 64%">${logo(INK, BLUE)}</div>
	</body>`;

/** The preview image: the logo and what the site does, over the grid of the canvas. */
const preview = `
	<style>
		@font-face { font-family: Inter; font-weight: 100 900; src: url('${inter}'); }
		body {
			margin: 0; height: 100vh; box-sizing: border-box; padding: 0 96px;
			display: flex; flex-direction: column; justify-content: center; gap: 36px;
			font-family: Inter, sans-serif; color: ${INK}; background-color: #ffffff;
			background-image:
				linear-gradient(#e3e7ee 1px, transparent 1px), linear-gradient(90deg, #e3e7ee 1px, transparent 1px),
				linear-gradient(#f0f2f6 1px, transparent 1px), linear-gradient(90deg, #f0f2f6 1px, transparent 1px);
			background-size: 150px 150px, 150px 150px, 30px 30px, 30px 30px;
		}
		.name { display: flex; align-items: center; gap: 28px; font-size: 104px; font-weight: 700; letter-spacing: -0.03em; }
		.name div { width: 150px; height: 150px; }
		p { margin: 0; font-size: 44px; line-height: 1.3; color: #404040; }
		b { color: ${BLUE}; font-weight: inherit; }
	</style>
	<body>
		<div class="name"><div>${logo(INK, BLUE)}</div><span>json<b>2</b>graph</span></div>
		<p>View any JSON document as a graph. Fast on files of 100 MB and more, and nothing is uploaded.</p>
	</body>`;

const images = [
	{ name: 'icon-192.png', width: 192, height: 192, html: icon },
	{ name: 'icon-512.png', width: 512, height: 512, html: icon },
	{ name: 'apple-touch-icon.png', width: 180, height: 180, html: icon },
	{ name: 'og.png', width: 1200, height: 630, html: preview }
];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
for (const { name, width, height, html } of images) {
	const page = await browser.newPage({ viewport: { width, height } });
	// A file: address, so the page may load the font from node_modules.
	await page.goto(new URL('package.json', root).href);
	await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: out(name) });
	await page.close();
	console.log(`static/${name}`);
}
await browser.close();
