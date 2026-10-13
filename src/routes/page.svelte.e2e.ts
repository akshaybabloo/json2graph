import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Replaces the whole text of the editor, as a paste would. */
async function replaceSource(page: Page, text: string) {
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

/** Exports with the choices made in the export menu, which must be open. */
async function exportImage(page: Page) {
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	return download;
}

/** The top left pixel of an exported image, which is in its margin, as RGBA. */
async function cornerPixel(page: Page, path: string): Promise<number[]> {
	const png = (await readFile(path)).toString('base64');
	return page.evaluate(async (png) => {
		const image = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${png}`)).blob()
		);
		const context = new OffscreenCanvas(1, 1).getContext('2d')!;
		context.drawImage(image, 0, 0);
		return [...context.getImageData(0, 0, 1, 1).data];
	}, png);
}

/** What the editor shows while it is empty. */
const PLACEHOLDER = 'Type or paste JSON here';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('starts with no document and says how to open one', async ({ page }) => {
	await expect(page.getByText(PLACEHOLDER)).toBeVisible();
	await expect(page.getByText(/untitled/)).toBeHidden();
	await expect(page.getByText(/loads a sample document/)).toBeVisible();
	await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
	await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

	// The skip link is the first stop of the page.
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to the graph' })).toBeFocused();
});

test('shows a document typed into the empty page in the middle of the canvas', async ({ page }) => {
	await replaceSource(page, '{"a": {"b": 1}}');
	// It has no file, so the summary stands without a name.
	await expect(page.getByText(/^15 B · 2 nodes/)).toBeVisible();

	// This small graph is a fraction of the canvas, so centred, it starts well
	// away from the top left corner.
	const canvas = page.locator('canvas');
	const view = await canvas.evaluate((element) => {
		const { x, y, k } = (element as unknown as { __zoom: { x: number; y: number; k: number } })
			.__zoom;
		return { x, y, k };
	});
	const { width, height } = (await canvas.boundingBox())!;
	expect(view.k).toBe(1);
	expect(view.x).toBeGreaterThan(width / 4);
	expect(view.y).toBeGreaterThan(height / 4);
});

test('formats the document without changing its values', async ({ page }) => {
	const source = '{\n"big":12345678901234567890,"list":[1.0,{}]}';
	await replaceSource(page, source);
	await expect(page.getByText('2 nodes')).toBeVisible();
	await expect(page.getByText('45 B')).toBeVisible();

	// What fits on a line stays on one; the number is too large to survive
	// being read as a number, and is still as it was written.
	await page.getByRole('button', { name: 'Format' }).click();
	await expect(page.locator('.cm-line')).toHaveText([
		'{',
		'  "big": 12345678901234567890,',
		'  "list": [1.0, {}]',
		'}',
		''
	]);
	// The graph is of the formatted text: the same nodes, in a larger document.
	await expect(page.getByText('55 B')).toBeVisible();
	await expect(page.getByText('2 nodes')).toBeVisible();

	// It is an edit, so it can be undone.
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('.cm-line')).toHaveText([
		'{',
		'"big":12345678901234567890,"list":[1.0,{}]}'
	]);
});

test('undoes formatting without undoing what was typed just before it', async ({ page }) => {
	await page.locator('.cm-content').click();
	await page.keyboard.insertText('{"a":1}');
	await page.keyboard.press('Shift+Alt+f');
	await expect(page.locator('.cm-line')).toHaveText(['{ "a": 1 }', '']);

	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('.cm-line')).toHaveText(['{"a":1}']);
});

test('leaves text that is not JSON as it is when asked to format it', async ({ page }) => {
	await replaceSource(page, '{"a": 1,}');
	await expect(page.getByRole('alert')).toContainText('line 1');

	await page.getByRole('button', { name: 'Format' }).click();
	await expect(page.locator('.cm-line')).toHaveText(['{"a": 1,}']);
	await expect(page.getByRole('alert')).toContainText('line 1');
});

test('shows that the engine is loading until it has loaded', async ({ page }) => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/*.wasm', async (route) => {
		await held;
		await route.continue();
	});
	await page.reload();
	await expect(page.getByRole('status')).toHaveText('Loading the graph engine…');

	release();
	await expect(page.getByRole('status')).toBeHidden();
	await expect(page.getByText(/loads a sample document/)).toBeVisible();
});

test('says so when the engine cannot be loaded', async ({ page }) => {
	await page.route('**/*.wasm', (route) => route.abort());
	await page.reload();
	await expect(page.getByRole('alert')).toContainText('The graph engine could not be loaded');
	await expect(page.getByRole('status')).toBeHidden();
});

test.describe('before the script of the page has run', () => {
	test.use({ javaScriptEnabled: false });

	test('is laid out as it will be, and says that it is loading', async ({ page }) => {
		const editor = (await page.getByRole('region', { name: 'JSON source' }).boundingBox())!;
		const graph = (await page.getByRole('region', { name: 'Graph', exact: true }).boundingBox())!;
		expect(graph.width / editor.width).toBeCloseTo(72 / 28, 1);
		await expect(page.getByRole('status')).toHaveText('Loading the graph engine…');
	});
});

test.describe('with the example open', () => {
	test.beforeEach(async ({ page }) => {
		await page.getByRole('button', { name: 'Example' }).click();
		// The sample has 16 non-empty objects and arrays.
		await expect(page.getByText('16 nodes')).toBeVisible();
	});

	test('shows the sample in the editor and as a graph', async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'json2graph' })).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('"name": "json2graph"');
	});

	test('describes itself to search engines and link previews', async ({ page }) => {
		await expect(page).toHaveTitle('json2graph: view JSON as a graph');
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			/JSON document as a graph/
		);
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			/json2graph/
		);
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			'href',
			/manifest\.webmanifest$/
		);

		const structured = await page.locator('script[type="application/ld+json"]').textContent();
		expect(JSON.parse(structured ?? '')).toMatchObject({
			'@type': 'WebApplication',
			name: 'json2graph'
		});
	});

	test('serves a sitemap and lets crawlers in', async ({ request }) => {
		const sitemap = await request.get('/sitemap.xml');
		expect(sitemap.headers()['content-type']).toContain('xml');
		expect(await sitemap.text()).toContain(
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
		);

		const robots = await request.get('/robots.txt');
		expect(await robots.text()).toContain('User-agent: *\nDisallow:\n');
	});

	test('moves the view from the keyboard', async ({ page }) => {
		const canvas = page.getByRole('application', {
			name: 'Graph of sample.json: 16 nodes, 52 values'
		});
		const view = () =>
			canvas.evaluate((element) => {
				const { x, y, k } = (element as unknown as { __zoom: { x: number; y: number; k: number } })
					.__zoom;
				return { x, y, k };
			});

		// The skip link leads to the canvas.
		await page.getByRole('link', { name: 'Skip to the graph' }).focus();
		await page.keyboard.press('Enter');
		await expect(canvas).toBeFocused();

		const start = await view();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowDown');
		const panned = await view();
		expect(panned.x).toBeCloseTo(start.x - 80);
		expect(panned.y).toBeCloseTo(start.y - 80);

		await page.keyboard.press('+');
		expect((await view()).k).toBeGreaterThan(start.k);
		await page.keyboard.press('-');
		await page.keyboard.press('-');
		expect((await view()).k).toBeLessThan(start.k);
	});

	test('links to the repository on GitHub', async ({ page }) => {
		const link = page.getByRole('link', { name: 'json2graph on GitHub' });
		await expect(link).toHaveAttribute('href', 'https://github.com/akshaybabloo/json2graph');
		await expect(link).toHaveAttribute('target', '_blank');
	});

	test('updates the graph when the source is edited', async ({ page }) => {
		await replaceSource(page, '{"a": {"b": [1, 2]}}');
		await expect(page.getByText('3 nodes')).toBeVisible();
	});

	test('keeps the last graph and reports the position while the source is invalid', async ({
		page
	}) => {
		await replaceSource(page, '{\n  "a": 1,\n  oops\n}');
		await expect(page.getByRole('alert')).toContainText('line 3, column 3');
		await expect(page.getByText('16 nodes')).toBeVisible();

		await replaceSource(page, '{"a": 1}');
		await expect(page.getByRole('alert')).toBeHidden();
		await expect(page.getByText('· 1 node ·')).toBeVisible();
	});

	test('opens a file into the editor and the graph', async ({ page }) => {
		await page.getByLabel('Open file').setInputFiles({
			name: 'tiny.json',
			mimeType: 'application/json',
			buffer: Buffer.from('[{"x": 1}, {"y": 2}]')
		});
		await expect(page.getByText('tiny.json')).toBeVisible();
		await expect(page.getByText('3 nodes')).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('[{"x": 1}, {"y": 2}]');
	});

	test('marks a value that is cut short as expandable', async ({ page }) => {
		await page.getByLabel('Open file').setInputFiles({
			name: 'long.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify({ long: 'word '.repeat(60) }))
		});
		await expect(page.getByText('· 1 node ·')).toBeVisible();

		// The only box is centred in the canvas, and its only row is cut short.
		const canvas = page.locator('canvas');
		const box = (await canvas.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect(canvas).toHaveCSS('cursor', 'pointer');
		await page.mouse.move(box.x + 10, box.y + 10);
		await expect(canvas).not.toHaveCSS('cursor', 'pointer');

		// Expanded, the value fills several lines, so the row is taller than it was.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
		await expect(canvas).toHaveCSS('cursor', 'pointer');
	});

	test('dims the graph around the path to the box under the pointer', async ({ page }) => {
		const canvas = page.locator('canvas');
		const box = (await canvas.boundingBox())!;
		// The graph as it is once the first frames have settled.
		let whole = await canvas.screenshot();
		await expect
			.poll(async () => {
				const last = whole;
				whole = await canvas.screenshot();
				return whole.equals(last);
			})
			.toBe(true);

		// The root box is at the left of the canvas, half way down.
		await page.mouse.move(box.x + 100, box.y + box.height / 2);
		await expect.poll(async () => (await canvas.screenshot()).equals(whole)).toBe(false);

		// Away from every box the graph is whole again.
		await page.mouse.move(box.x + 10, box.y + 10);
		await expect.poll(async () => (await canvas.screenshot()).equals(whole)).toBe(true);
	});

	test('zooms from the toolbar and exports the graph as a PNG', async ({ page }) => {
		const scale = () =>
			page
				.locator('canvas')
				.evaluate((canvas) => (canvas as unknown as { __zoom: { k: number } }).__zoom.k);

		const fitted = await scale();
		await page.getByRole('button', { name: 'Zoom in' }).click();
		expect(await scale()).toBeGreaterThan(fitted);
		await page.getByRole('button', { name: 'Zoom out' }).click();
		await page.getByRole('button', { name: 'Zoom out' }).click();
		expect(await scale()).toBeLessThan(fitted);
		await page.getByRole('button', { name: 'Fit to view' }).click();
		expect(await scale()).toBeCloseTo(fitted);

		await page.getByRole('button', { name: 'Export as image' }).click();
		expect((await exportImage(page)).suggestedFilename()).toBe('sample.png');
	});

	test('exports over a transparent or a chosen background, without the grid', async ({ page }) => {
		const menu = page.getByRole('button', { name: 'Export as image' });
		await menu.click();
		await page.getByRole('checkbox', { name: 'Keep grid' }).click();
		await page.getByRole('radio', { name: 'Transparent' }).click();
		const transparent = await exportImage(page);
		expect(await cornerPixel(page, await transparent.path())).toEqual([0, 0, 0, 0]);

		// The menu remembers the last choices, and picking a colour selects it.
		await menu.click();
		await expect(page.getByRole('checkbox', { name: 'Keep grid' })).not.toBeChecked();
		await page.getByLabel('Background colour').fill('#ff0000');
		await expect(page.getByRole('radio', { name: 'Custom colour' })).toBeChecked();
		const coloured = await exportImage(page);
		expect(await cornerPixel(page, await coloured.path())).toEqual([255, 0, 0, 255]);
	});

	test('switches to dark mode and remembers it', async ({ page }) => {
		const html = page.locator('html');
		await expect(html).not.toHaveClass(/dark/);
		await page.getByRole('button', { name: 'Switch between light and dark mode' }).click();
		await expect(html).toHaveClass(/dark/);

		await page.reload();
		await expect(html).toHaveClass(/dark/);
	});

	test('clears the editor and the graph, then accepts a new document', async ({ page }) => {
		// Make the document invalid first: clearing also removes the error.
		await replaceSource(page, '{ oops');
		await expect(page.getByRole('alert')).toBeVisible();

		await page.getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
		await expect(page.getByRole('alert')).toBeHidden();
		await expect(page.getByText('sample.json')).toBeHidden();
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
		await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

		await replaceSource(page, '{"fresh": [1, 2]}');
		await expect(page.getByText('2 nodes')).toBeVisible();
	});

	test('loads the example again after clearing', async ({ page }) => {
		await page.getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();

		await page.getByRole('button', { name: 'Example' }).click();
		await expect(page.getByText('sample.json')).toBeVisible();
		await expect(page.getByText('16 nodes')).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('"name": "json2graph"');
	});

	test('treats an emptied editor as no document rather than an error', async ({ page }) => {
		await replaceSource(page, '   ');
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
		await expect(page.getByRole('alert')).toBeHidden();
	});

	test('draws indent guides in the editor', async ({ page }) => {
		// "email" is nested three levels deep in the sample.
		const line = page.locator('.cm-line', { hasText: '"email"' });
		await expect(line).toHaveClass(/cm-indent-guides/);
		await expect(line).toHaveAttribute('style', /--indent-levels: 3/);
		await expect(page.locator('.cm-line').first()).not.toHaveClass(/cm-indent-guides/);
	});
});
