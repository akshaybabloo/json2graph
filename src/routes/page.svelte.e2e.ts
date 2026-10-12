import { expect, test, type Page } from '@playwright/test';

/** Replaces the whole text of the editor, as a paste would. */
async function replaceSource(page: Page, text: string) {
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	// The sample has 16 non-empty objects and arrays.
	await expect(page.getByText('16 nodes')).toBeVisible();
});

test('shows the sample in the editor and as a graph', async ({ page }) => {
	await expect(page.getByRole('heading', { name: 'json2graph' })).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('"name": "json2graph"');
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

	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export as image' }).click();
	expect((await download).suggestedFilename()).toBe('sample.png');
});

test('switches to dark mode and remembers it', async ({ page }) => {
	const html = page.locator('html');
	await expect(html).not.toHaveClass(/dark/);
	await page.getByRole('button', { name: 'Switch between light and dark mode' }).click();
	await expect(html).toHaveClass(/dark/);

	await page.reload();
	await expect(html).toHaveClass(/dark/);
	await expect(page.getByText('16 nodes')).toBeVisible();
});

test('clears the editor and the graph, then accepts a new document', async ({ page }) => {
	// Make the document invalid first: clearing also removes the error.
	await replaceSource(page, '{ oops');
	await expect(page.getByRole('alert')).toBeVisible();

	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page.locator('.cm-content')).toHaveText('');
	await expect(page.getByRole('alert')).toBeHidden();
	await expect(page.getByText('untitled.json')).toBeVisible();
	await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
	await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

	await replaceSource(page, '{"fresh": [1, 2]}');
	await expect(page.getByText('2 nodes')).toBeVisible();
});

test('loads the example again after clearing', async ({ page }) => {
	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page.locator('.cm-content')).toHaveText('');

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
