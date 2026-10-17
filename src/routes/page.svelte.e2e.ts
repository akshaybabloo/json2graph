import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Replaces the whole text of the editor, as a paste would. */
async function replaceSource(page: Page, text: string) {
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

/** Opens the example of a type from the Example menu. */
async function openExample(page: Page, type = 'JSON') {
	await page.getByRole('button', { name: 'Example' }).click();
	await page.getByRole('menuitem', { name: type }).click();
	// Until the menu has faded out, the page takes no pointer events.
	await expect(page.getByRole('menu')).toBeHidden();
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

/**
 * A picture of the graph once it has stopped changing, without the toolbar and
 * the hint that lie over the corners of the canvas.
 */
async function graphShot(page: Page): Promise<Buffer> {
	const box = (await page.locator('canvas').boundingBox())!;
	const clip = { x: box.x, y: box.y, width: box.width - 80, height: box.height - 48 };
	let shot = await page.screenshot({ clip });
	await expect
		.poll(async () => {
			const last = shot;
			shot = await page.screenshot({ clip });
			return shot.equals(last);
		})
		.toBe(true);
	return shot;
}

/** What the editor shows while it is empty. */
const PLACEHOLDER = 'Type or paste here';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('leaves the right-click menu to the browser while there is no graph', async ({ page }) => {
	await expect(page.getByRole('status')).toBeHidden();
	await page.locator('canvas').click({ button: 'right' });
	await expect(page.getByRole('menu')).toHaveCount(0);
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

	// With the editor hidden, the page does not point to it.
	await page.getByRole('button', { name: 'Hide editor' }).click();
	await expect(page.getByText('Open a file, or drop one anywhere on the page.')).toBeVisible();
	await page.getByRole('button', { name: 'Show editor' }).click();
	await expect(page.getByText(/Type or paste on the left/)).toBeVisible();
});

test('shows the version it was built as, and links it to the release', async ({ page }) => {
	const version = page.getByRole('link', { name: 'Version 0.0.0 on GitHub' });
	await expect(version).toHaveText('0.0.0');
	await expect(version).toHaveAttribute(
		'href',
		'https://github.com/akshaybabloo/json2graph/releases/tag/0.0.0'
	);
	await expect(version).toHaveAttribute('target', '_blank');
});

test('lets the editor be formatted and cleared only when there is something in it', async ({
	page
}) => {
	const format = page.getByRole('button', { name: 'Format' });
	const clear = page.getByRole('button', { name: 'Clear' });
	await expect(format).toBeDisabled();
	await expect(clear).toBeDisabled();

	await page.locator('.cm-content').click();
	await page.keyboard.insertText('{');
	await expect(format).toBeEnabled();
	await expect(clear).toBeEnabled();
	await page.keyboard.press('Backspace');
	await expect(format).toBeDisabled();
	await expect(clear).toBeDisabled();
});

test('shows a document typed into the empty page in the middle of the canvas', async ({ page }) => {
	await replaceSource(page, '{"a": {"b": 1}}');
	// It has no file, so the summary stands without a name.
	await expect(page.locator('header p[aria-live]')).toHaveText(/^\s*15 B · 2 nodes/);

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

test('opens a file of several megabytes into the editor as well as the graph', async ({ page }) => {
	const rows = Array.from({ length: 60_000 }, (_, id) => ({
		id,
		name: `row-${id}`,
		note: 'x'.repeat(64)
	}));
	const text = JSON.stringify(rows, null, 2);
	expect(text.length).toBeGreaterThan(6_000_000);
	await page.locator('input[type=file]').setInputFiles({
		name: 'rows.json',
		mimeType: 'application/json',
		buffer: Buffer.from(text)
	});

	await expect(page.getByText(/60,001 nodes/)).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('"name": "row-0"');
	await expect(page.getByText(/too large to edit as text/)).toBeHidden();
	await expect(page.getByRole('button', { name: 'Format' })).toBeEnabled();
});

test('shows a file too large for the editor as a graph only, with nothing to format', async ({
	page
}) => {
	const format = page.getByRole('button', { name: 'Format' });
	const clear = page.getByRole('button', { name: 'Clear' });
	await replaceSource(page, '{"a":1}');
	await expect(format).toBeEnabled();

	// A little over the hundred megabytes that the editor takes, so it is emptied.
	const large = test.info().outputPath('large.json');
	await writeFile(large, JSON.stringify(Array.from({ length: 106 }, () => 'x'.repeat(1_000_000))));
	await page.locator('input[type=file]').setInputFiles(large);
	await expect(page.getByText(/too large to edit as text/)).toBeVisible();
	await expect(page.getByText(/1 node · 107 values/)).toBeVisible();
	await expect(format).toBeDisabled();

	// The file is kept over a reload, although its text is not in the editor.
	await expect
		.poll(async () => (await savedTabs(page))?.[1]?.size, { timeout: 30_000 })
		.toBeGreaterThan(100_000_000);
	await page.reload();
	await expect(page.getByText(/too large to edit as text/)).toBeVisible();
	await expect(page.getByText(/1 node · 107 values/)).toBeVisible({ timeout: 15_000 });

	// The file is still open, so it can be cleared.
	await expect(clear).toBeEnabled();
	await clear.click();
	await expect(page.getByText(/too large to edit as text/)).toBeHidden();
	await expect(clear).toBeDisabled();
});

test('collapses a node into its row, and shows it again', async ({ page }) => {
	// Two boxes of the same width, so the graph is centred on the gap between
	// them: the control of the root's row is half that gap left of the middle.
	await replaceSource(page, '{"a": {"b": 123}}');
	await expect(page.getByText('2 nodes')).toBeVisible();
	const canvas = page.locator('canvas');
	const box = (await canvas.boundingBox())!;
	const control = { x: box.x + box.width / 2 - 36, y: box.y + box.height / 2 };
	const away = () => page.mouse.move(box.x + 10, box.y + 10);
	await away();
	const whole = await graphShot(page);

	// The pointer on the control is not on the box: nothing is dimmed.
	await page.mouse.move(control.x, control.y);
	await expect(canvas).toHaveCSS('cursor', 'pointer');
	expect((await graphShot(page)).equals(whole)).toBe(true);
	await page.mouse.click(control.x, control.y);
	expect((await graphShot(page)).equals(whole)).toBe(false);

	// The row has not moved, and its control brings the node back, as bright
	// as the rest.
	await page.mouse.click(control.x, control.y);
	expect((await graphShot(page)).equals(whole)).toBe(true);
});

test('collapses every node into the root, and expands them all again', async ({ page }) => {
	await replaceSource(page, '{"a": {"b": {"c": 1}}, "d": [1, 2]}');
	await expect(page.getByText('4 nodes')).toBeVisible();
	const box = (await page.locator('canvas').boundingBox())!;
	const away = () => page.mouse.move(box.x + 10, box.y + 10);
	await away();
	const whole = await graphShot(page);

	await page.getByRole('button', { name: 'Collapse all nodes' }).click();
	await away();
	expect((await graphShot(page)).equals(whole)).toBe(false);

	// The same button now expands them, which gives the first graph back.
	await page.getByRole('button', { name: 'Expand all nodes' }).click();
	await away();
	expect((await graphShot(page)).equals(whole)).toBe(true);

	// A new document starts with every node shown.
	await page.getByRole('button', { name: 'Collapse all nodes' }).click();
	await expect(page.getByRole('button', { name: 'Expand all nodes' })).toBeVisible();
	await replaceSource(page, '{"a": {"b": 1}}');
	await expect(page.getByText('2 nodes')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Collapse all nodes' })).toBeVisible();
});

test('undoes formatting without undoing what was typed just before it', async ({ page }) => {
	await page.locator('.cm-content').click();
	await page.keyboard.insertText('{"a":1}');
	await page.keyboard.press('Shift+Alt+f');
	await expect(page.locator('.cm-line')).toHaveText(['{ "a": 1 }', '']);

	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('.cm-line')).toHaveText(['{"a":1}']);
});

test('fetches the formatter when it is first used, and only then', async ({ page }) => {
	const fetched: string[] = [];
	page.on('request', (request) => {
		if (/formatter_bg.*\.wasm/.test(request.url())) fetched.push(request.url());
	});
	const format = page.getByRole('button', { name: 'Format' });

	await replaceSource(page, '{"a":1}');
	await expect(page.getByText('1 node')).toBeVisible();
	expect(fetched).toHaveLength(0);

	// Until it has downloaded, the button says it is formatting, and cannot be pressed again.
	let download!: () => void;
	const downloaded = new Promise<void>((resolve) => (download = resolve));
	await page.route(/formatter_bg.*\.wasm/, async (route) => {
		await downloaded;
		await route.continue();
	});
	await format.click();
	await expect(page.getByRole('button', { name: 'Formatting…' })).toBeDisabled();
	await expect(page.locator('.cm-line')).toHaveText(['{"a":1}']);
	download();
	await expect(page.locator('.cm-line')).toHaveText(['{ "a": 1 }', '']);
	await expect(page.getByRole('button', { name: 'Format', exact: true })).toBeEnabled();
	await replaceSource(page, '{"b":2}');
	await format.click();
	await expect(page.locator('.cm-line')).toHaveText(['{ "b": 2 }', '']);
	expect(fetched).toHaveLength(1);
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
		const editor = (await page.getByRole('region', { name: 'Source' }).boundingBox())!;
		const graph = (await page.getByRole('region', { name: 'Graph', exact: true }).boundingBox())!;
		expect(graph.width / editor.width).toBeCloseTo(72 / 28, 1);
		await expect(page.getByRole('status')).toHaveText('Loading the graph engine…');
	});
});

/** Opens a file with this name and text, as the Open file button does. */
async function openFile(page: Page, name: string, text: string) {
	await page.getByLabel('Open file').setInputFiles({
		name,
		mimeType: 'application/json',
		buffer: Buffer.from(text)
	});
}

/** A tab as it is saved in the browser's storage. */
type SavedTab = { name: string | null; size: number; type: string; typeChosen: boolean };

/** The tabs as saved in the browser's storage. Null until something is saved. */
async function savedRecords(page: Page) {
	return page.evaluate(
		() =>
			new Promise<SavedTab[] | null>((resolve, reject) => {
				const open = indexedDB.open('json2graph');
				// Not created here: the page's worker creates it.
				open.onupgradeneeded = () => open.transaction?.abort();
				open.onerror = () => resolve(null);
				open.onsuccess = () => {
					const database = open.result;
					const read = database.transaction('session').objectStore('session').get('tabs');
					read.onsuccess = () => {
						database.close();
						const session = read.result as { tabs: SavedTab[] } | undefined;
						resolve(session?.tabs ?? null);
					};
					read.onerror = () => reject(read.error);
				};
			})
	);
}

/** The names of the saved tabs, and the size of the content saved for each. */
async function savedTabs(page: Page) {
	return (await savedRecords(page))?.map(({ name, size }) => ({ name, size })) ?? null;
}

/** The types of the contents saved in the browser's storage. */
async function savedTypes(page: Page) {
	return page.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				const open = indexedDB.open('json2graph');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const database = open.result;
					const read = database.transaction('content').objectStore('content').getAll();
					read.onsuccess = () => {
						database.close();
						resolve((read.result as Blob[]).map((content) => content.type));
					};
					read.onerror = () => reject(read.error);
				};
			})
	);
}

test.describe('tabs', () => {
	const A = '{"a": {"b": 1}}';
	const B = '[{"x": 1}, {"y": 2}, {"z": 3}]';

	test.beforeEach(async ({ page }) => {
		// Once the page has started, so that it takes the files given to it.
		await expect(page.getByRole('status')).toBeHidden();
	});

	test('opens each file in a tab of its own, and shows each one as it was', async ({ page }) => {
		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveText(['Untitled']);

		// The empty tab is used for the first file, and a new one for the next.
		await openFile(page, 'a.json', A);
		await expect(tabs).toHaveText(['a.json']);
		await expect(page.getByText('2 nodes')).toBeVisible();
		await openFile(page, 'b.json', B);
		await expect(tabs).toHaveText(['a.json', 'b.json']);
		await expect(page.getByRole('tab', { name: 'b.json' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.locator('.cm-content')).toContainText('"z": 3');
		await expect(page.getByText('4 nodes')).toBeVisible();

		await page.getByRole('tab', { name: 'a.json' }).click();
		await expect(page.locator('.cm-content')).toHaveText(A);
		await expect(page.getByText('2 nodes')).toBeVisible();
		await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /tab-/);

		// The arrow keys move between the tabs, and Enter shows one.
		await page.getByRole('tab', { name: 'a.json' }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('tab', { name: 'b.json' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByText('4 nodes')).toBeVisible();
	});

	test('keeps the graph of a hidden tab as it was left, until the tab is unused for a while', async ({
		page
	}) => {
		await page.clock.install();
		await page.goto('/');
		// Once the page has started, so that it takes the file.
		await expect(page.getByRole('status')).toBeHidden();
		await openFile(page, 'a.json', A);
		await expect(page.getByText('2 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Collapse all nodes' }).click();
		await openFile(page, 'b.json', B);
		await expect(page.getByText('4 nodes')).toBeVisible();

		// Kept: the nodes are still collapsed.
		await page.getByRole('tab', { name: 'a.json' }).click();
		await expect(page.getByText('2 nodes')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Expand all nodes' })).toBeVisible();

		// Left for long enough, the tab is indexed again, with every node shown.
		await page.getByRole('tab', { name: 'b.json' }).click();
		await expect(page.getByText('4 nodes')).toBeVisible();
		await page.clock.fastForward('11:00');
		const tooltip = page.locator('[data-slot=tooltip-content]');
		await page.getByRole('tab', { name: 'a.json' }).hover();
		await expect(tooltip).toContainText('Freed to save memory');
		await page.getByRole('tab', { name: 'a.json' }).click();
		await page.mouse.move(0, 0);
		await page.getByRole('tab', { name: 'a.json' }).hover();
		await expect(tooltip).toContainText('Double-click to rename');
		await expect(page.getByText('2 nodes')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Collapse all nodes' })).toBeVisible();
	});

	test('opens a new empty tab, and keeps the text and undo history of each', async ({ page }) => {
		await replaceSource(page, '{"x": 1}');
		await expect(page.getByText('1 node')).toBeVisible();

		await page.getByRole('button', { name: 'New tab' }).click();
		await expect(page.getByRole('tab')).toHaveCount(2);
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();

		await page.getByRole('tab').first().click();
		await expect(page.locator('.cm-content')).toHaveText('{"x": 1}');
		await expect(page.getByText('1 node')).toBeVisible();
		await page.locator('.cm-content').click();
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
	});

	test('renames a tab that is double-clicked, or given F2', async ({ page }) => {
		await openFile(page, 'a.json', A);
		await expect(page.getByText('2 nodes')).toBeVisible();
		const field = page.getByRole('textbox', { name: 'Name of the tab' });

		await page.getByRole('tab', { name: 'a.json' }).dblclick();
		await expect(field).toBeFocused();
		await expect(field).toHaveValue('a.json');
		await field.fill('orders.json');
		await field.press('Enter');
		await expect(page.getByRole('tab')).toHaveText(['orders.json']);
		await expect(page.getByRole('tab', { name: 'orders.json' })).toBeFocused();

		// Escape, or a blank name, keeps the name it had.
		await page.keyboard.press('F2');
		await field.fill('other.json');
		await field.press('Escape');
		await expect(page.getByRole('tab')).toHaveText(['orders.json']);
		await page.keyboard.press('F2');
		await field.fill('  ');
		await field.press('Enter');
		await expect(page.getByRole('tab')).toHaveText(['orders.json']);

		// Leaving the field keeps what was typed.
		await page.getByRole('tab', { name: 'orders.json' }).dblclick();
		await field.fill('kept.json');
		await page.locator('canvas').click();
		await expect(page.getByRole('tab')).toHaveText(['kept.json']);
	});

	test('shows the type of the document in the footer, detected or chosen', async ({ page }) => {
		const type = page.getByRole('button', { name: 'Type of the document: JSON' });
		await expect(type).toBeVisible();
		await type.click();
		await expect(page.getByRole('menuitemradio', { name: 'Detect automatically' })).toBeChecked();
		await page.getByRole('menuitemradio', { name: 'JSON' }).click();
		await expect(page.getByRole('menu')).toBeHidden();

		// Chosen, the type is kept with the tab.
		const chosen = async () => {
			const record = (await savedRecords(page))?.[0];
			return record && [record.type, record.typeChosen];
		};
		await expect.poll(chosen).toEqual(['json', true]);
		await page.reload();
		await page.getByRole('button', { name: 'Type of the document: JSON' }).click();
		await expect(page.getByRole('menuitemradio', { name: 'JSON' })).toBeChecked();
		await page.getByRole('menuitemradio', { name: 'Detect automatically' }).click();
		await expect.poll(chosen).toEqual(['json', false]);
	});

	test('keeps the tabs over a reload, with what was typed in them', async ({ page }) => {
		await openFile(page, 'a.json', A);
		await openFile(page, 'b.json', B);
		await page.getByRole('tab', { name: 'b.json' }).dblclick();
		await page.getByRole('textbox', { name: 'Name of the tab' }).fill('renamed.json');
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: 'New tab' }).click();
		await replaceSource(page, '{"typed": true}');
		await expect(page.getByText('1 node')).toBeVisible();
		await page.getByRole('tab', { name: 'a.json' }).click();
		await expect
			.poll(() => savedTabs(page), { timeout: 10_000 })
			.toEqual([
				{ name: 'a.json', size: A.length },
				{ name: 'renamed.json', size: B.length },
				{ name: null, size: '{"typed": true}'.length }
			]);

		expect(await savedTypes(page)).toEqual(Array(3).fill('application/json'));

		// The page says it is restoring the tabs until it has: here, until the
		// workers it waits for are let through.
		let release = () => {};
		const released = new Promise<void>((resolve) => (release = resolve));
		await page.route('**/workers/worker-*.js', async (route) => {
			await released;
			await route.continue();
		});
		await page.reload();
		await expect(page.getByText('Restoring your tabs…')).toBeVisible();
		release();
		await expect(page.getByText('Restoring your tabs…')).toBeHidden();
		await expect(page.getByRole('tab')).toHaveText(['a.json', 'renamed.json', 'Untitled']);
		await expect(page.getByRole('tab', { name: 'a.json' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.locator('.cm-content')).toHaveText(A);
		await expect(page.getByText('2 nodes')).toBeVisible();
		await page.getByRole('tab', { name: 'renamed.json' }).click();
		await expect(page.locator('.cm-content')).toContainText('"z": 3');
		await expect(page.getByText('4 nodes')).toBeVisible();
		await page.getByRole('tab', { name: 'Untitled' }).click();
		await expect(page.locator('.cm-content')).toHaveText('{"typed": true}');
		await expect(
			page.getByText('Tabs are kept in this browser until you close them')
		).toBeVisible();
	});

	test('asks before the page is left while an edit is not yet saved', async ({ page }) => {
		const typed = '{"late": 1}';
		await replaceSource(page, typed);
		const asked = new Promise<string>((resolve) => {
			page.once('dialog', async (dialog) => {
				resolve(dialog.type());
				// Stay on the page.
				await dialog.dismiss();
			});
		});
		page.reload({ timeout: 5000 }).catch(() => {});
		expect(await asked).toBe('beforeunload');

		// Asking started the save, so leaving no longer asks.
		await expect.poll(() => savedTabs(page)).toEqual([{ name: null, size: typed.length }]);
		page.once('dialog', (dialog) => {
			throw new Error(`Asked again: ${dialog.type()}`);
		});
		await page.reload();
		await expect(page.locator('.cm-content')).toHaveText(typed);
	});

	test('forgets a closed tab', async ({ page }) => {
		await openFile(page, 'a.json', A);
		await openFile(page, 'b.json', B);
		await page.getByRole('button', { name: 'Close a.json' }).click();
		await expect
			.poll(() => savedTabs(page), { timeout: 10_000 })
			.toEqual([{ name: 'b.json', size: B.length }]);

		await page.reload();
		await expect(page.getByRole('tab')).toHaveText(['b.json']);
		await expect(page.getByText('4 nodes')).toBeVisible();
	});

	test('leaves the tabs to the first window when a second one is open', async ({
		page,
		context
	}) => {
		await openFile(page, 'a.json', A);
		await expect.poll(() => savedTabs(page)).toEqual([{ name: 'a.json', size: A.length }]);

		const second = await context.newPage();
		await second.goto('/');
		await expect(second.getByRole('status')).toBeHidden();
		await expect(second.getByRole('tab')).toHaveText(['Untitled']);
		await expect(second.getByText(/another window keeps its own/)).toBeVisible();
		await openFile(second, 'b.json', B);
		await expect(second.getByText('4 nodes')).toBeVisible();

		// The second window saved nothing over the first one's tabs.
		await page.reload();
		await expect(page.getByRole('tab')).toHaveText(['a.json']);
	});

	test('reads the large text of a tab left unused back from storage when it is shown', async ({
		page
	}) => {
		await page.clock.install();
		await page.goto('/');
		await expect(page.getByRole('status')).toBeHidden();
		const rows = Array.from({ length: 25_000 }, (_, i) => ({ id: i, name: `row-${i}` }));
		const large = JSON.stringify(rows, null, 2);
		expect(large.length).toBeGreaterThan(1_000_000);
		await openFile(page, 'rows.json', large);
		await expect(page.getByText('25,001 nodes')).toBeVisible();
		await openFile(page, 'b.json', B);
		await expect(page.getByText('4 nodes')).toBeVisible();

		await page.clock.fastForward('11:00');
		await page.getByRole('tab', { name: 'rows.json' }).click();
		await expect(page.getByText('25,001 nodes')).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('"name": "row-0"');
		// Read back, the text has no undo history: undoing does not take away the file.
		await page.locator('.cm-content').click();
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.locator('.cm-content')).toContainText('"name": "row-0"');
	});

	test('closes the other tabs, or all of them, from the menu at the start of the tabs', async ({
		page
	}) => {
		const menu = page.getByRole('button', { name: 'Tab actions' });
		await openFile(page, 'a.json', A);
		await openFile(page, 'b.json', B);
		await page.getByRole('button', { name: 'New tab' }).click();
		await page.getByRole('tab', { name: 'b.json' }).click();
		await expect(page.getByText('4 nodes')).toBeVisible();

		await menu.click();
		await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
		await expect(page.getByRole('tab')).toHaveText(['b.json']);
		await expect(page.getByText('4 nodes')).toBeVisible();
		await menu.click();
		await expect(page.getByRole('menuitem', { name: 'Close other tabs' })).toBeDisabled();
		await page.keyboard.press('Escape');

		await openFile(page, 'a.json', A);
		await menu.click();
		await page.getByRole('menuitem', { name: 'Close all tabs' }).click();
		await expect(page.getByRole('tab')).toHaveText(['Untitled']);
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
		await expect
			.poll(() => savedTabs(page), { timeout: 10_000 })
			.toEqual([{ name: null, size: 0 }]);
	});

	test('renames and closes tabs from the menu of a tab', async ({ page }) => {
		await openFile(page, 'a.json', A);
		await openFile(page, 'b.json', B);
		await openFile(page, 'c.json', A);
		await expect(page.getByRole('tab')).toHaveText(['a.json', 'b.json', 'c.json']);

		await page.getByRole('tab', { name: 'a.json' }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Rename' }).click();
		// Gone before the next menu opens, rather than still fading out.
		await expect(page.getByRole('menu')).toBeHidden();
		const field = page.getByRole('textbox', { name: 'Name of the tab' });
		await expect(field).toBeFocused();
		await field.fill('first.json');
		await field.press('Enter');
		await expect(page.getByRole('tab')).toHaveText(['first.json', 'b.json', 'c.json']);

		await page.getByRole('tab', { name: 'c.json' }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Close tab' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		await expect(page.getByRole('tab')).toHaveText(['first.json', 'b.json']);

		// The other tabs are those other than the one clicked, which is shown.
		await page.getByRole('tab', { name: 'first.json' }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		await expect(page.getByRole('tab')).toHaveText(['first.json']);
		await expect(page.locator('.cm-content')).toHaveText(A);
		await expect(page.getByText('2 nodes')).toBeVisible();

		await page.getByRole('tab', { name: 'first.json' }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Close all tabs' }).click();
		await expect(page.getByRole('tab')).toHaveText(['Untitled']);
	});

	test('closes a tab and shows the one next to it, and empties the last one', async ({ page }) => {
		await openFile(page, 'a.json', A);
		await openFile(page, 'b.json', B);
		await expect(page.getByText('4 nodes')).toBeVisible();

		await page.getByRole('button', { name: 'Close b.json' }).click();
		await expect(page.getByRole('tab')).toHaveText(['a.json']);
		await expect(page.locator('.cm-content')).toHaveText(A);
		await expect(page.getByText('2 nodes')).toBeVisible();

		await page.getByRole('button', { name: 'Close a.json' }).click();
		await expect(page.getByRole('tab')).toHaveText(['Untitled']);
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
	});
});

test('opens an example into an empty tab, and asks where to when the tab is in use', async ({
	page
}) => {
	await openExample(page);
	await expect(page.getByRole('tab')).toHaveText(['sample.json']);
	await expect(page.getByRole('alertdialog')).toBeHidden();

	await replaceSource(page, '{"mine": 1}');
	await expect(page.getByText('1 node')).toBeVisible();
	const dialog = page.getByRole('alertdialog');

	// Cancelled, nothing changes.
	await openExample(page);
	await expect(dialog).toContainText('sample.json already has a document in it');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('.cm-content')).toHaveText('{"mine": 1}');

	await openExample(page);
	await dialog.getByRole('button', { name: 'Open in a new tab' }).click();
	await expect(page.getByRole('tab')).toHaveText(['sample.json', 'sample.json']);
	await expect(page.getByText('16 nodes')).toBeVisible();

	await page.getByRole('tab').first().click();
	await expect(page.locator('.cm-content')).toHaveText('{"mine": 1}');
	await openExample(page);
	await dialog.getByRole('button', { name: 'Replace this tab' }).click();
	await expect(page.getByRole('tab')).toHaveCount(2);
	await expect(page.locator('.cm-content')).toContainText('"name": "json2graph"');
	await expect(page.getByText('16 nodes')).toBeVisible();
});

test.describe('CSV', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	test('shows a table as a graph, with the table below it', async ({ page }) => {
		await openExample(page, 'CSV');
		await expect(page.getByRole('tab', { name: 'people.csv' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Type of the document: CSV' })).toBeVisible();
		// The array, and an object for each of the eight rows.
		await expect(page.getByText('9 nodes')).toBeVisible();

		const table = page.getByRole('table', { name: 'Rows' });
		await expect(table).toHaveAttribute('aria-rowcount', '9');
		await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
		await expect(table.getByRole('row').nth(1)).toContainText('Ada Lovelace');
		// A field over two lines is shown on one.
		await expect(table.getByRole('row').nth(4)).toContainText('team ↵ and named');

		// Not for a document that is not a table.
		await page.getByRole('button', { name: 'New tab' }).click();
		await expect(page.getByRole('region', { name: 'Table' })).toBeHidden();
		await page.getByRole('tab', { name: 'people.csv' }).click();
		await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
	});

	test('colours each column of the text in turn', async ({ page }) => {
		await replaceSource(page, 'name;"city, state";age\nAda;"London,\nUK";36');
		await expect(page.getByRole('button', { name: 'Type of the document: CSV' })).toBeVisible();
		const colour = (text: string) =>
			page
				.locator('.cm-content')
				.getByText(text, { exact: true })
				.first()
				.evaluate((span) => getComputedStyle(span).color);
		const [name, city, age] = [
			await colour('name'),
			await colour('"city, state"'),
			await colour('age')
		];
		expect(new Set([name, city, age]).size).toBe(3);
		// A quoted field over two lines keeps its column's colour, and so does the column after it.
		expect(await colour('"London,')).toBe(city);
		expect(await colour('UK"')).toBe(city);
		expect(await colour('36')).toBe(age);
		expect(await colour(';')).not.toBe(name);
	});

	test('resizes the table, and hides the graph or the table from the footer', async ({ page }) => {
		await openExample(page, 'CSV');
		await expect(page.getByText('9 nodes')).toBeVisible();
		const graph = page.getByRole('region', { name: 'Graph' });
		const table = page.getByRole('region', { name: 'Table' });
		const height = async () => (await table.boundingBox())!.height;

		// Dragged up, the table grows; the size stays.
		const before = await height();
		const handle = page.getByRole('separator', { name: 'Resize the graph and the table' });
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
		await page.mouse.up();
		await expect.poll(height).toBeGreaterThan(before + 100);
		const dragged = await height();

		await page.getByRole('button', { name: 'Hide table' }).click();
		await expect(table).toBeHidden();
		await page.getByRole('button', { name: 'Show table' }).click();
		await expect.poll(height).toBeCloseTo(dragged, -1);

		// Without the graph, the table takes its place.
		await page.getByRole('button', { name: 'Hide graph' }).click();
		await expect(graph).toBeHidden();
		await expect.poll(height).toBeGreaterThan(dragged + 100);

		// Whatever shows last stays.
		await page.getByRole('button', { name: 'Hide editor' }).click();
		await expect(page.getByRole('button', { name: 'Hide table' })).toBeDisabled();
		await page.getByRole('button', { name: 'Show editor' }).click();
		await page.getByRole('button', { name: 'Hide table' }).click();
		await expect(table).toBeHidden();
		await expect(page.getByRole('button', { name: 'Hide editor' })).toBeDisabled();

		// With the editor hidden and only the table left, a tab without a table brings the graph back.
		await page.getByRole('button', { name: 'Show table' }).click();
		await page.getByRole('button', { name: 'Hide editor' }).click();
		await page.getByRole('button', { name: 'New tab' }).click();
		await expect(graph).toBeVisible();
		await expect(page.getByRole('button', { name: 'Hide graph' })).toBeDisabled();
		await page.getByRole('button', { name: 'Show editor' }).click();

		// A document without a table hides the graph alone, and gives the editor the room.
		await expect(page.getByRole('button', { name: 'Hide table' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Show table' })).toHaveCount(0);
		const editorWidth = (await page.getByRole('region', { name: 'Source' }).boundingBox())!.width;
		await page.getByRole('button', { name: 'Hide graph' }).click();
		await expect(graph).toBeHidden();
		await expect
			.poll(async () => (await page.getByRole('region', { name: 'Source' }).boundingBox())!.width)
			.toBeGreaterThan(editorWidth * 2);
		await page.getByRole('button', { name: 'Show graph' }).click();
		await expect(graph).toBeVisible();
	});

	test('widens a column that is dragged, fitted or moved with the keys', async ({ page }) => {
		await openExample(page, 'CSV');
		const table = page.getByRole('table', { name: 'Rows' });
		const notes = table.getByRole('columnheader', { name: 'notes' });
		await expect(notes).toBeVisible();
		const width = async () => (await notes.boundingBox())!.width;
		const edge = table.getByRole('slider', { name: 'Width of notes' });

		const start = await width();
		const box = (await edge.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 5 });
		await page.mouse.up();
		await expect.poll(width).toBeCloseTo(start + 100, -1);

		// Fitted, it is as wide as its longest note, which is longer than it starts.
		await edge.dblclick();
		await expect(
			table.getByText('Wrote the first published algorithm, for the Analytical Engine')
		).toBeVisible();
		const fitted = await width();
		await edge.focus();
		await page.keyboard.press('ArrowLeft');
		await expect.poll(width).toBeLessThan(fitted);
	});

	test('opens a field that does not fit its column in full', async ({ page }) => {
		await openExample(page, 'CSV');
		const table = page.getByRole('table', { name: 'Rows' });
		const full = 'Wrote the first published algorithm, for the Analytical Engine';
		await table.getByRole('button', { name: 'Wrote the first published' }).click();
		const detail = page.getByRole('dialog');
		await expect(detail).toContainText('notes');
		await expect(detail).toContainText(full);
		await page.keyboard.press('Escape');
		await expect(detail).toBeHidden();

		// With its line breaks, which the table shows as arrows.
		await table.getByRole('button', { name: /Led the Apollo/ }).click();
		await expect(detail.locator('p').last()).toHaveText(
			'Led the Apollo flight software team\nand named it software engineering'
		);

		// A field that fits is not a button.
		await expect(table.getByRole('button', { name: 'London' })).toHaveCount(0);
	});

	test('takes what is typed for a table when it looks like one', async ({ page }) => {
		await replaceSource(page, 'name,age\nAda,36\nGrace,85');
		await expect(page.getByRole('button', { name: 'Type of the document: CSV' })).toBeVisible();
		await expect(page.getByText('3 nodes')).toBeVisible();
		await expect(page.getByRole('table', { name: 'Rows' }).getByRole('row')).toHaveCount(3);
	});

	test('scrolls to the last of a great many rows', async ({ page }) => {
		const count = 300_000;
		const rows = Array.from({ length: count }, (_, i) => `${i},row-${i}`);
		await openFile(page, 'many.csv', `id,name\n${rows.join('\n')}\n`);
		await expect(page.getByText('300,001 nodes')).toBeVisible({ timeout: 15_000 });

		const table = page.getByRole('table', { name: 'Rows' });
		const scroller = page.locator('[data-scroller]');
		await expect(table).toHaveAttribute('aria-rowcount', String(count + 1));
		// Part way into a row, the row is cut off below the header, not drawn over it.
		await scroller.evaluate((element) => (element.scrollTop = 1000 * 28 + 14));
		const header = (await table.getByRole('row').first().boundingBox())!;
		const above = await page.evaluate(
			([x, y]) => document.elementFromPoint(x, y)?.closest('tr')?.getAttribute('aria-rowindex'),
			[header.x + header.width / 3, header.y + header.height - 2]
		);
		expect(above).toBe('1');

		await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight));
		await expect(table.getByText(`row-${count - 1}`)).toBeVisible();
		await scroller.evaluate((element) => (element.scrollTop = 0));
		await expect(table.getByText('row-0', { exact: true })).toBeVisible();
	});
});

test.describe('Plot', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
		await openExample(page, 'CSV');
		await expect(page.getByText('9 nodes')).toBeVisible();
	});

	const plot = (page: Page) => page.getByRole('region', { name: 'Plot' });
	const column = (page: Page, name: string) =>
		page.getByRole('table', { name: 'Rows' }).getByRole('button', { name, exact: true });

	/** The names of the traces in the legend of the plot, once it is drawn. */
	async function legend(page: Page) {
		await expect(plot(page).locator('.main-svg').first()).toBeVisible();
		await expect(plot(page).getByRole('status')).toHaveCount(0);
		return plot(page).locator('.legendtext').allTextContents();
	}

	test('plots the columns chosen in the table, from its right-click menu', async ({ page }) => {
		await expect(plot(page)).toBeHidden();
		await column(page, 'born').click();
		await column(page, 'languages').click({ modifiers: ['ControlOrMeta'] });
		await expect(column(page, 'born')).toHaveAttribute('aria-pressed', 'true');
		await column(page, 'languages').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Plot 2 columns' }).click();
		await expect(page.getByRole('menu')).toBeHidden();

		await expect(plot(page)).toBeVisible();
		expect(await legend(page)).toEqual(['born', 'languages']);
		// The ids, which only go up, name the rows.
		await expect(plot(page).getByRole('button', { name: /Across\s*id/ })).toBeVisible();

		// Text is not plotted.
		await column(page, 'name').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Plot' })).toBeDisabled();
		await expect(page.getByText('name holds text, so it is not plotted.')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toBeHidden();

		await plot(page).getByRole('button', { name: 'Hide the plot' }).click();
		await expect(plot(page)).toBeHidden();
		// Hidden, it is kept: shown again, it plots the same columns.
		await page.getByRole('button', { name: 'Show plot' }).click();
		expect(await legend(page)).toEqual(['born', 'languages']);
	});

	test('plots true as 1 and false as 0', async ({ page }) => {
		await column(page, 'active').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Plot active' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		expect(await legend(page)).toEqual([]);
		await expect
			.poll(async () => (await plot(page).locator('.ytick text').allTextContents()).sort())
			.toEqual(['false', 'true']);
	});

	test('draws lines, points or bars', async ({ page }) => {
		await column(page, 'born').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Plot born' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		await legend(page);
		await expect(plot(page).locator('.scatterlayer .js-line')).toHaveCount(1);

		await plot(page).getByRole('button', { name: 'Chart: Line' }).click();
		await page.getByRole('menuitemradio', { name: 'Bars' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		await expect(plot(page).locator('.barlayer .point')).toHaveCount(8);
	});

	test('sits beside the graph above the table, and takes the place of the graph hidden', async ({
		page
	}) => {
		await page.getByRole('button', { name: 'Plot the table' }).click();
		await legend(page);
		const graph = page.getByRole('region', { name: 'Graph' });
		const table = page.getByRole('region', { name: 'Table' });
		const [graphBox, plotBox, tableBox] = await Promise.all(
			[graph, plot(page), table].map(async (region) => (await region.boundingBox())!)
		);
		expect(plotBox.x).toBeGreaterThanOrEqual(graphBox.x + graphBox.width);
		expect(tableBox.y).toBeGreaterThanOrEqual(plotBox.y + plotBox.height);
		expect(tableBox.width).toBeGreaterThan(graphBox.width + plotBox.width - 20);

		const handle = (name: string) => page.getByRole('separator', { name: `Resize the ${name}` });
		await expect(handle('editor and the graph')).toBeVisible();
		await expect(handle('graph and the plot')).toBeVisible();
		await expect(handle('graph and the table')).toBeVisible();

		const width = async () => (await plot(page).boundingBox())!.width;
		await page.getByRole('button', { name: 'Hide graph' }).click();
		await expect(graph).toBeHidden();
		await expect.poll(width).toBeGreaterThan(plotBox.width + 100);
		// A handle goes with a pane beside it.
		await expect(handle('graph and the plot')).toBeHidden();
		await expect(handle('graph and the table')).toBeVisible();

		await page.getByRole('button', { name: 'Hide plot' }).click();
		await expect(plot(page)).toBeHidden();
		await expect(table).toBeVisible();
		await expect(handle('graph and the table')).toBeHidden();
		await page.getByRole('button', { name: 'Hide editor' }).click();
		await expect(handle('editor and the graph')).toBeHidden();
		await page.getByRole('button', { name: 'Show editor' }).click();
		await expect(handle('editor and the graph')).toBeVisible();
		await page.getByRole('button', { name: 'Show graph' }).click();
		await expect(graph).toBeVisible();
		await expect(plot(page)).toBeHidden();
		await page.getByRole('button', { name: 'Show plot' }).click();
		await expect(plot(page)).toBeVisible();
		await expect(graph).toBeVisible();
	});

	test('keeps plotting the columns that are left when others are taken out of the text', async ({
		page
	}) => {
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));
		await page.getByRole('button', { name: 'Plot the table' }).click();
		expect(await legend(page)).toEqual(['born', 'languages', 'active']);

		await replaceSource(page, 'id,name,city,born\n1,Ada,London,1815\n2,Grace,New York,1906\n');
		await expect.poll(() => plot(page).locator('.legendtext').allTextContents()).toEqual([]);
		await expect(plot(page).locator('.scatterlayer .trace')).toHaveCount(1);

		await replaceSource(page, 'id,name\n1,Ada\n2,Grace\n');
		await expect(
			plot(page).getByText('No column of numbers is chosen.', { exact: false })
		).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('is shown alone, and then with what was shown before', async ({ page }) => {
		// From the footer, before anything is plotted.
		await page.getByRole('button', { name: 'Show plot' }).click();
		await legend(page);
		const graph = page.getByRole('region', { name: 'Graph' });
		const table = page.getByRole('region', { name: 'Table' });
		const source = page.getByRole('region', { name: 'Source' });
		const alone = plot(page).getByRole('button', { name: 'Show only the plot' });

		await alone.click();
		await expect(alone).toHaveAttribute('aria-pressed', 'true');
		await expect(graph).toBeHidden();
		await expect(table).toBeHidden();
		await expect(source).toBeHidden();
		// Whatever shows last stays.
		await expect(page.getByRole('button', { name: 'Hide plot' })).toBeDisabled();
		const width = (await plot(page).boundingBox())!.width;
		expect(width).toBeGreaterThan(page.viewportSize()!.width - 20);

		await alone.click();
		await expect(alone).toHaveAttribute('aria-pressed', 'false');
		await expect(graph).toBeVisible();
		await expect(table).toBeVisible();
		await expect(source).toBeVisible();
	});

	test("opens from the graph's toolbar, and is kept with the tab", async ({ page }) => {
		const button = page.getByRole('button', { name: 'Plot the table' });
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		// None chosen: the first columns that can be plotted, against the ids.
		expect(await legend(page)).toEqual(['born', 'languages', 'active']);

		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'false');
		await expect(plot(page)).toBeHidden();
		await button.click();
		await expect(plot(page)).toBeVisible();

		await page.reload();
		await expect(page.getByText('9 nodes')).toBeVisible();
		expect(await legend(page)).toEqual(['born', 'languages', 'active']);
	});
});

test.describe('YAML', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	test('shows YAML as a graph, and exports it named after the file', async ({ page }) => {
		await openExample(page, 'YAML');
		await expect(page.getByRole('tab', { name: 'service.yaml' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Type of the document: YAML' })).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('defaults: &defaults');
		// Merge keys copy what they merge: each environment has resources of its own.
		await expect(page.getByText('14 nodes')).toBeVisible();

		await page.getByRole('button', { name: 'Export as image' }).click();
		expect((await exportImage(page)).suggestedFilename()).toBe('service.png');
	});

	test('colours the values in the text as the graph colours them', async ({ page }) => {
		await replaceSource(
			page,
			'# A person\nname: Ada\nage: 36\nactive: true\nnext: ~\ncity: "London"\n'
		);
		await expect(page.getByRole('button', { name: 'Type of the document: YAML' })).toBeVisible();
		// The innermost element with the text: a value is marked inside its highlighting.
		const colour = (text: string) =>
			page
				.locator('.cm-content')
				.getByText(text, { exact: true })
				.last()
				.evaluate((span) => getComputedStyle(span).color);
		const token = (name: string) =>
			page.evaluate((name) => {
				const probe = document.body.appendChild(document.createElement('span'));
				probe.style.color = `var(${name})`;
				const colour = getComputedStyle(probe).color;
				probe.remove();
				return colour;
			}, name);

		expect(await colour('Ada')).toBe(await token('--json-string'));
		expect(await colour('"London"')).toBe(await token('--json-string'));
		expect(await colour('36')).toBe(await token('--json-number'));
		expect(await colour('true')).toBe(await token('--json-boolean'));
		expect(await colour('~')).toBe(await token('--muted-foreground'));
		expect(await colour('# A person')).toBe(await token('--muted-foreground'));
		expect(await colour('age')).toBe(await token('--foreground'));
	});

	test('takes keys and values that are typed for YAML', async ({ page }) => {
		await replaceSource(page, '# A person\nname: Ada\nlanguages:\n  - Analytical Engine\n');
		await expect(page.getByRole('button', { name: 'Type of the document: YAML' })).toBeVisible();
		await expect(page.getByText('2 nodes')).toBeVisible();
	});

	test('keeps the last graph and says where the mistake is while the YAML is invalid', async ({
		page
	}) => {
		await replaceSource(page, 'a:\n  b: 1\n');
		await expect(page.getByText('2 nodes')).toBeVisible();
		await replaceSource(page, 'a:\n  b: c: d\n');
		await expect(page.getByRole('alert')).toContainText('at line 2, column 7');
		await expect(page.getByText('2 nodes')).toBeVisible();
	});

	test('formats YAML, keeping its comments', async ({ page }) => {
		await replaceSource(page, 'list:\n-   a # first\n-   {x: 1,y: [1,2]}\n');
		await expect(page.getByText('4 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Format' }).click();
		await expect(page.locator('.cm-line')).toHaveText([
			'list:',
			'  - a # first',
			'  - { x: 1, y: [1, 2] }',
			''
		]);
		await expect(page.getByText('4 nodes')).toBeVisible();
	});
});

test.describe('Mermaid', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	const diagram = (page: Page) => page.locator('[data-diagram] svg');

	test('draws a diagram where the graph would be, and exports it named after the file', async ({
		page
	}) => {
		await openExample(page, 'Mermaid');
		await expect(page.getByRole('tab', { name: 'flow.mmd' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Type of the document: Mermaid' })).toBeVisible();
		await expect(diagram(page)).toContainText('What type is it?');
		await expect(page.getByText(/· flowchart ·/)).toBeVisible();
		await expect(
			page.getByRole('application', { name: 'Diagram of flow.mmd: flowchart' })
		).toBeVisible();
		// Nothing to format, and no nodes to collapse.
		await expect(page.getByRole('button', { name: 'Format' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Collapse all nodes' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Export as image' }).click();
		const download = await exportImage(page);
		expect(download.suggestedFilename()).toBe('flow.png');
		const path = await download.path();
		expect((await readFile(path)).subarray(1, 4).toString()).toBe('PNG');
	});

	test('colours the text as the Mermaid Live Editor does', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  %% A note\n  start[Begin] -->|go| finish');
		await expect(page.getByRole('button', { name: 'Type of the document: Mermaid' })).toBeVisible();
		const style = (text: string) =>
			page
				.locator('.cm-content')
				.getByText(text, { exact: true })
				.last()
				.evaluate((span) => {
					const { color, fontWeight } = getComputedStyle(span);
					return { color, bold: Number(fontWeight) >= 600 };
				});
		const token = (name: string) =>
			page.evaluate((name) => {
				const probe = document.body.appendChild(document.createElement('span'));
				probe.style.color = `var(${name})`;
				const colour = getComputedStyle(probe).color;
				probe.remove();
				return colour;
			}, name);

		expect(await style('flowchart')).toEqual({ color: await token('--json-boolean'), bold: true });
		expect(await style('LR')).toEqual({ color: await token('--json-boolean'), bold: false });
		expect(await style('start')).toEqual({ color: await token('--json-container'), bold: false });
		expect((await style('[Begin]')).color).toBe(await token('--json-string'));
		expect((await style('|go|')).color).toBe(await token('--json-string'));
		expect(await style('-->')).toEqual({ color: await token('--brand'), bold: true });
		expect((await style('%% A note')).color).toBe(await token('--muted-foreground'));
		// Not ended while Mermaid is still downloading: the server would say the page went away.
		await expect(diagram(page)).toContainText('Begin');
	});

	test('draws the labels of edges over the line, not under it', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A -->|label| B');
		await expect(diagram(page)).toContainText('label');
		const [label, background] = await diagram(page)
			.locator('.edgeLabel')
			.filter({ hasText: 'label' })
			.last()
			.evaluate((element) => {
				const probe = document.body.appendChild(document.createElement('span'));
				probe.style.backgroundColor = 'var(--background)';
				const background = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return [getComputedStyle(element).backgroundColor, background];
			});
		expect(label).toBe(background);
	});

	test('shows the whole of a diagram drawn while it was hidden, once it is shown', async ({
		page
	}) => {
		await page.getByRole('button', { name: 'Hide graph' }).click();
		await replaceSource(page, 'flowchart LR\n  A --> B');
		await expect(page.getByRole('button', { name: 'Type of the document: Mermaid' })).toBeVisible();
		await expect(diagram(page)).toContainText('B');

		await page.getByRole('button', { name: 'Show diagram' }).click();
		const scale = () =>
			page
				.locator('[data-diagram]')
				.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
		await expect.poll(scale).toBeGreaterThan(0.5);
		await expect(diagram(page)).toBeInViewport();
	});

	test('draws the grid of the graph behind the diagram', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A --> B');
		await expect(diagram(page)).toContainText('B');
		const lines = page
			.getByRole('application', { name: /^Diagram/ })
			.locator('canvas')
			.evaluate((canvas: HTMLCanvasElement) => {
				const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
				return data.some((value, index) => index % 4 === 3 && value > 0);
			});
		expect(await lines).toBe(true);
	});

	test('zooms the diagram from the toolbar and the keys', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A --> B');
		await expect(diagram(page)).toContainText('B');
		const scale = () =>
			page
				.locator('[data-diagram]')
				.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
		const fitted = await scale();
		await page.getByRole('button', { name: 'Zoom in' }).click();
		expect(await scale()).toBeGreaterThan(fitted);
		await page.getByRole('application', { name: /^Diagram/ }).focus();
		await page.keyboard.press('0');
		expect(await scale()).toBeCloseTo(fitted);
	});

	test('keeps the last diagram and says where the mistake is while the text is invalid', async ({
		page
	}) => {
		await replaceSource(page, 'sequenceDiagram\n  Alice->>Bob: Hello');
		await expect(page.getByRole('button', { name: 'Type of the document: Mermaid' })).toBeVisible();
		await expect(diagram(page)).toContainText('Alice');
		await page.keyboard.insertText('\n  Bob->>');
		await expect(page.getByRole('alert')).toContainText('Parse error on line 3');
		await expect(diagram(page)).toContainText('Alice');

		await page.keyboard.insertText('Alice: Hi');
		await expect(page.getByRole('alert')).toBeHidden();
		await expect(diagram(page)).toContainText('Hi');
	});

	test('draws the diagram again in the other theme', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A --> B');
		const fill = () =>
			diagram(page)
				.locator('.node rect')
				.first()
				.evaluate((rect) => getComputedStyle(rect).fill);
		await expect(diagram(page)).toContainText('B');
		const light = await fill();
		await page.getByRole('button', { name: 'Switch between light and dark mode' }).click();
		await expect.poll(fill).not.toBe(light);
	});

	test('draws nodes flat, without gradients or shadows, in either theme', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A --> B');
		const look = () =>
			diagram(page)
				.locator('.node rect')
				.first()
				.evaluate((rect) => {
					const style = getComputedStyle(rect);
					return { stroke: style.stroke.startsWith('url('), filter: style.filter };
				});
		await expect(diagram(page)).toContainText('B');
		for (const theme of ['light', 'dark']) {
			// Drawn again after the switch.
			await expect.poll(look, { message: theme }).toEqual({ stroke: false, filter: 'none' });
			await page.getByRole('button', { name: 'Switch between light and dark mode' }).click();
		}
	});

	test('shows the graph again for a tab that is not a diagram', async ({ page }) => {
		await replaceSource(page, 'flowchart LR\n  A --> B');
		await expect(diagram(page)).toBeVisible();
		await page.getByRole('button', { name: 'New tab' }).click();
		await replaceSource(page, '{"a": {"b": 1}}');
		await expect(page.getByText('2 nodes')).toBeVisible();
		await expect(diagram(page)).toHaveCount(0);
		await expect(page.getByRole('application', { name: /^Graph/ })).toBeVisible();

		// Back on the first tab, its diagram is drawn again.
		await page.getByRole('tab', { name: 'Untitled' }).first().click();
		await expect(diagram(page)).toContainText('B');
	});
});

test.describe('with the example open', () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page);
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

	test('hides the editor so the graph takes the whole width, and shows it again', async ({
		page
	}) => {
		const source = page.getByRole('region', { name: 'Source' });
		const canvas = page.locator('canvas');
		const width = (await canvas.boundingBox())!.width;

		const hide = page.getByRole('button', { name: 'Hide editor' });
		await hide.hover();
		await expect(page.locator('[data-slot=tooltip-content]')).toHaveText('Hide editor');
		await hide.click();
		await expect(source).toBeHidden();
		await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(width);

		const show = page.getByRole('button', { name: 'Show editor' });
		await expect(show).toHaveAttribute('aria-expanded', 'false');
		await show.click();
		await expect(source).toBeVisible();
		await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(width);
		await expect(page.getByRole('button', { name: 'Hide editor' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	});

	test('shows the hidden editor when an opened file is not JSON, to say why', async ({ page }) => {
		await page.getByRole('button', { name: 'Hide editor' }).click();
		await page.getByLabel('Open file').setInputFiles({
			name: 'broken.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"a": }')
		});
		await expect(page.getByRole('region', { name: 'Source' })).toBeVisible();
		await expect(page.getByRole('alert')).toContainText('line 1');
	});

	test('opens a file into the editor and the graph', async ({ page }) => {
		await page.getByLabel('Open file').setInputFiles({
			name: 'tiny.json',
			mimeType: 'application/json',
			buffer: Buffer.from('[{"x": 1}, {"y": 2}]')
		});
		await expect(page.getByRole('tab', { name: 'tiny.json' })).toBeVisible();
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

	test('does what the toolbar does from the right-click menu of the graph', async ({ page }) => {
		const canvas = page.locator('canvas');
		await canvas.click({ button: 'right' });
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitem')).toHaveText([
			/Zoom in/,
			/Zoom out/,
			/Fit to view/,
			/Find in the graph/,
			'Collapse all nodes',
			'Export as image…'
		]);
		await menu.getByRole('menuitem', { name: 'Collapse all nodes' }).click();
		await expect(page.getByRole('button', { name: 'Expand all nodes' })).toBeVisible();

		await canvas.click({ button: 'right' });
		await expect(menu.getByRole('menuitem', { name: 'Expand all nodes' })).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Export as image…' }).click();
		await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');

		await canvas.click({ button: 'right' });
		await menu.getByRole('menuitem', { name: /Find in the graph/ }).click();
		await expect(page.getByRole('textbox', { name: 'Find in the graph' })).toBeFocused();
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
		await expect(page.getByRole('button', { name: 'Clear' })).toBeDisabled();
		await expect(page.locator('.cm-content')).toBeFocused();
		await expect(page.getByText(/\d+ nodes?/)).toBeHidden();
		await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

		await replaceSource(page, '{"fresh": [1, 2]}');
		await expect(page.getByText('2 nodes')).toBeVisible();
	});

	test('loads the example again after clearing', async ({ page }) => {
		await page.getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();

		await openExample(page);
		await expect(page.getByRole('tab', { name: 'sample.json' })).toBeVisible();
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

test('marks no other copies of the text selected in the editor', async ({ page }) => {
	await replaceSource(page, '{"a": "a", "b": ["a", "a"]}');
	await page.keyboard.press('ControlOrMeta+Home');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(page.locator('.cm-selectionBackground')).toHaveCount(1);
	await expect(page.locator('.cm-selectionMatch')).toHaveCount(0);
});

test.describe('linking the graph and the code', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	/**
	 * The text selected in the editor, as the browser has it once the editor
	 * has focus, which CodeMirror gives its selection to a frame later.
	 */
	async function selected(page: Page) {
		await page.locator('.cm-content').focus();
		return page.evaluate(() => getSelection()?.toString() ?? '');
	}

	/** The middle of row `row` of a graph of one box, which is centred on the canvas. */
	async function rowOfOneBox(page: Page, row: number, rows: number) {
		const box = (await page.locator('canvas').boundingBox())!;
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 + (row - (rows - 1) / 2) * 24 };
	}

	/** How many pixels of the canvas are in the colour that marks the linked row. */
	async function markedPixels(page: Page) {
		const png = (await page.locator('canvas').screenshot()).toString('base64');
		return page.evaluate(async (png) => {
			const image = await createImageBitmap(
				await (await fetch(`data:image/png;base64,${png}`)).blob()
			);
			const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
			context.drawImage(image, 0, 0);
			const data = context.getImageData(0, 0, image.width, image.height).data;
			let count = 0;
			// --brand in the light theme, #2457d6: the outline is drawn in it, and
			// the blue of nested objects and arrays is not.
			for (let i = 0; i < data.length; i += 4) {
				const near =
					Math.abs(data[i] - 0x24) < 12 &&
					Math.abs(data[i + 1] - 0x57) < 12 &&
					Math.abs(data[i + 2] - 0xd6) < 12;
				if (near) count++;
			}
			return count;
		}, png);
	}

	/** Puts the cursor of the editor `steps` characters from the start of the text. */
	async function cursorAt(page: Page, steps: number) {
		await page.locator('.cm-content').focus();
		await page.keyboard.press('ControlOrMeta+Home');
		for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
	}

	const DOC = '{"name": "Ada ✓", "age": 36}';

	test('selects in the code the value of a row clicked in the graph, and all of a node clicked on its edge', async ({
		page
	}) => {
		const doc = '{"name": "Ada ✓", "langs": ["en", "fr"], "age": 36}';
		await replaceSource(page, doc);
		await expect(page.getByText('2 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Collapse all nodes' }).click();
		const age = await rowOfOneBox(page, 2, 3);
		await page.mouse.click(age.x, age.y);
		await expect.poll(() => selected(page)).toBe('36');

		const name = await rowOfOneBox(page, 0, 3);
		await page.mouse.click(name.x, name.y);
		await expect.poll(() => selected(page)).toBe('"Ada ✓"');

		// A row holding an array: all of the array.
		const langs = await rowOfOneBox(page, 1, 3);
		await page.mouse.click(langs.x, langs.y);
		await expect.poll(() => selected(page)).toBe('["en", "fr"]');

		// Just above its top edge: the node, brackets and all.
		const top = await rowOfOneBox(page, 0, 3);
		await page.mouse.move(top.x, top.y - 14);
		await expect(page.locator('canvas')).toHaveCSS('cursor', 'pointer');
		await page.mouse.click(top.x, top.y - 14);
		await expect.poll(() => selected(page)).toBe(doc);

		// Away from the nodes: nothing is selected, or marked.
		const box = (await page.locator('canvas').boundingBox())!;
		await page.mouse.click(box.x + 40, box.y + 40);
		await expect.poll(() => selected(page)).toBe('');
		await expect.poll(() => markedPixels(page)).toBeLessThan(5);
	});

	test('marks in the graph the row the cursor of the code is in', async ({ page }) => {
		await replaceSource(page, DOC);
		await expect(page.getByText('1 node')).toBeVisible();
		const away = async () => {
			const box = (await page.locator('canvas').boundingBox())!;
			await page.mouse.move(box.x + 10, box.y + 10);
		};
		// Clicked, the row of `age` is marked as the cursor marks it.
		const age = await rowOfOneBox(page, 1, 2);
		await page.mouse.click(age.x, age.y);
		await away();
		const clicked = await graphShot(page);
		expect(await markedPixels(page)).toBeGreaterThan(20);

		await cursorAt(page, DOC.indexOf('Ada'));
		const onName = await graphShot(page);
		expect(onName.equals(clicked)).toBe(false);
		await cursorAt(page, DOC.indexOf('36'));
		expect((await graphShot(page)).equals(clicked)).toBe(true);

		// Typed ahead of the graph, nothing is marked until it catches up.
		await page.keyboard.type('5');
		await expect.poll(() => markedPixels(page)).toBeLessThan(5);
		await expect.poll(() => markedPixels(page)).toBeGreaterThan(20);
	});

	test('brings the row of the cursor onto the screen', async ({ page }) => {
		const items = Array.from({ length: 300 }, (_, i) => `{"item": ${i}}`);
		await replaceSource(page, `[${items.join(', ')}]`);
		await expect(page.getByText('301 nodes')).toBeVisible();
		// Inside the last item, whose box is far below the root.
		await page.locator('.cm-content').focus();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => markedPixels(page)).toBeGreaterThan(20);
	});

	test('is turned off in Settings', async ({ page }) => {
		await replaceSource(page, DOC);
		await expect(page.getByText('1 node')).toBeVisible();
		await page.getByRole('button', { name: 'Settings' }).click();
		const link = page.getByRole('menuitemcheckbox', { name: 'Link the graph and the code' });
		await expect(link).toBeChecked();
		await link.click();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toBeHidden();

		const age = await rowOfOneBox(page, 1, 2);
		await page.mouse.click(age.x, age.y);
		expect(await selected(page)).toBe('');
		await cursorAt(page, DOC.indexOf('36'));
		expect(await markedPixels(page)).toBeLessThan(5);
	});
});

test.describe('finding text in the graph', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	const DOC = '{"name": "Ada", "langs": ["en", "fr"], "nested": {"Name": "Grace", "x": "banana"}}';

	/** How many pixels of the canvas are near `rgb`, give or take 12 in each channel. */
	async function pixelsNear(page: Page, rgb: [number, number, number]) {
		const png = (await page.locator('canvas').screenshot()).toString('base64');
		return page.evaluate(
			async ([png, rgb]) => {
				const image = await createImageBitmap(
					await (await fetch(`data:image/png;base64,${png}`)).blob()
				);
				const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
				context.drawImage(image, 0, 0);
				const data = context.getImageData(0, 0, image.width, image.height).data;
				let count = 0;
				for (let i = 0; i < data.length; i += 4) {
					const near = [0, 1, 2].every((c) => Math.abs(data[i + c] - rgb[c]) < 12);
					if (near) count++;
				}
				return count;
			},
			[png, rgb] as const
		);
	}

	/** --graph-found in the light theme, #eab308, which outlines the row gone to. */
	const FOUND: [number, number, number] = [0xea, 0xb3, 0x08];

	test('finds keys and values, and goes through them with Enter and Shift+Enter', async ({
		page
	}) => {
		await replaceSource(page, DOC);
		await expect(page.getByText('3 nodes')).toBeVisible();
		await page.locator('canvas').focus();
		await page.keyboard.press('ControlOrMeta+f');
		const find = page.getByRole('textbox', { name: 'Find in the graph' });
		await expect(find).toBeFocused();
		const status = page.locator('#graph-search-status');

		// Two keys and a value, whatever their case, the first gone to.
		await find.fill('na');
		await expect(status).toHaveText('1 of 3');
		await expect.poll(() => pixelsNear(page, FOUND)).toBeGreaterThan(20);
		await page.keyboard.press('Enter');
		await expect(status).toHaveText('2 of 3');
		await page.keyboard.press('Enter');
		await expect(status).toHaveText('3 of 3');
		await page.keyboard.press('Enter');
		await expect(status).toHaveText('1 of 3');
		await page.keyboard.press('Shift+Enter');
		await expect(status).toHaveText('3 of 3');
		await page.getByRole('button', { name: 'Previous match' }).click();
		await expect(status).toHaveText('2 of 3');

		// The case matters once asked to: not the key `Name`.
		await page.getByRole('checkbox', { name: 'Match case' }).click();
		await expect(status).toHaveText('1 of 2');
		await find.fill('nope');
		await expect(status).toHaveText('No results');
		await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled();
		await expect.poll(() => pixelsNear(page, FOUND)).toBeLessThan(5);
	});

	test('selects in the code the row it goes to', async ({ page }) => {
		await replaceSource(page, DOC);
		await expect(page.getByText('3 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Find in the graph' }).click();
		await page.getByRole('textbox', { name: 'Find in the graph' }).fill('banana');
		await expect(page.locator('#graph-search-status')).toHaveText('1 of 1');
		await page.locator('.cm-content').focus();
		await expect.poll(() => page.evaluate(() => getSelection()?.toString() ?? '')).toBe('"banana"');
	});

	test('opens the nodes a row it finds is collapsed in', async ({ page }) => {
		await replaceSource(page, '{"a": 1, "nested": {"deep": {"name": "Grace"}}}');
		await expect(page.getByText('3 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Collapse all nodes' }).click();
		const collapsed = await graphShot(page);

		await page.locator('canvas').focus();
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find in the graph' }).fill('grace');
		await expect(page.locator('#graph-search-status')).toHaveText('1 of 1');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('search')).toBeHidden();
		await expect(page.locator('canvas')).toBeFocused();
		// Away from the nodes, which marks nothing.
		const box = (await page.locator('canvas').boundingBox())!;
		await page.mouse.click(box.x + 10, box.y + 10);
		// All of it, as it is shown once every node is, without the outline of the focus.
		await page.keyboard.press('0');
		await page.locator('canvas').blur();
		const found = await graphShot(page);
		expect(found.equals(collapsed)).toBe(false);

		// The nodes of `nested` and `deep` are shown, which are all there are.
		await page.getByRole('button', { name: 'Expand all nodes' }).click();
		expect((await graphShot(page)).equals(found)).toBe(true);
	});

	test('marks nothing once closed, and finds the same again when opened', async ({ page }) => {
		await replaceSource(page, DOC);
		await expect(page.getByText('3 nodes')).toBeVisible();
		await page.getByRole('button', { name: 'Find in the graph' }).click();
		await page.getByRole('textbox', { name: 'Find in the graph' }).fill('ada');
		await expect.poll(() => pixelsNear(page, FOUND)).toBeGreaterThan(20);
		await page.getByRole('button', { name: 'Close the search' }).click();
		await expect.poll(() => pixelsNear(page, FOUND)).toBeLessThan(5);

		await page.getByRole('button', { name: 'Find in the graph' }).click();
		await expect(page.getByRole('textbox', { name: 'Find in the graph' })).toHaveValue('ada');
		await expect(page.locator('#graph-search-status')).toHaveText('1 of 1');
		await expect.poll(() => pixelsNear(page, FOUND)).toBeGreaterThan(20);

		// Again in the new graph of an edit, which it has not gone to a row of.
		await replaceSource(page, '{"a": "Ada", "b": "ada", "c": "x"}');
		await expect(page.locator('#graph-search-status')).toHaveText('2 found');
	});
});

test.describe('Settings', () => {
	test.beforeEach(async ({ page }) => {
		await expect(page.getByRole('status')).toBeHidden();
	});

	/** Opens the settings menu. */
	async function openSettings(page: Page) {
		await page.getByRole('button', { name: 'Settings' }).click();
		await expect(page.getByRole('menu')).toBeVisible();
	}

	/** Closes the settings menu, and waits until the page takes the pointer again. */
	async function closeSettings(page: Page) {
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toBeHidden();
	}

	test('draws connections sharp or curved, and remembers the choice', async ({ page }) => {
		await replaceSource(page, '{"a": {"x": 1}, "b": [1, 2], "c": {"y": {"z": 1}}}');
		await expect(page.getByText('5 nodes')).toBeVisible();
		const curved = await graphShot(page);

		await openSettings(page);
		await expect(page.getByRole('menuitemradio', { name: 'Curved' })).toBeChecked();
		await page.getByRole('menuitemradio', { name: 'Sharp' }).click();
		await expect(page.getByRole('menuitemradio', { name: 'Sharp' })).toBeChecked();
		await closeSettings(page);
		const sharp = await graphShot(page);
		expect(sharp.equals(curved)).toBe(false);

		await page.reload();
		await expect(page.getByText('5 nodes')).toBeVisible();
		await openSettings(page);
		await expect(page.getByRole('menuitemradio', { name: 'Sharp' })).toBeChecked();
		await closeSettings(page);
		expect((await graphShot(page)).equals(sharp)).toBe(true);
	});

	test('leaves the connections of a Mermaid diagram to Mermaid', async ({ page }) => {
		await openExample(page, 'Mermaid');
		await expect(page.locator('[data-diagram] svg')).toContainText('What type is it?');

		await openSettings(page);
		await expect(page.getByText('Mermaid diagrams draw their own connections.')).toBeVisible();
		await expect(page.getByRole('menuitemradio', { name: 'Curved' })).toBeDisabled();
		await expect(page.getByRole('menuitemradio', { name: 'Sharp' })).toBeDisabled();
		await expect(
			page.getByRole('menuitemcheckbox', { name: 'Show keys on connections' })
		).toBeDisabled();
		await expect(
			page.getByRole('menuitemcheckbox', { name: 'Remember tabs in this browser' })
		).toBeEnabled();
		await closeSettings(page);

		// On a tab of JSON, they can be changed again.
		await page.getByRole('button', { name: 'New tab' }).click();
		await openSettings(page);
		await expect(page.getByText('Mermaid diagrams draw their own connections.')).toHaveCount(0);
		await expect(page.getByRole('menuitemradio', { name: 'Sharp' })).toBeEnabled();
		await expect(
			page.getByRole('menuitemcheckbox', { name: 'Show keys on connections' })
		).toBeEnabled();
		await closeSettings(page);
	});

	test('writes the key of each node on the connection to it, array elements too', async ({
		page
	}) => {
		await replaceSource(page, '{"address": {"city": "Pune"}, "matrix": [[1, 2], [3, 4]]}');
		await expect(page.getByText('5 nodes')).toBeVisible();
		const plain = await graphShot(page);

		await openSettings(page);
		const keys = page.getByRole('menuitemcheckbox', { name: 'Show keys on connections' });
		await expect(keys).not.toBeChecked();
		await keys.click();
		await expect(keys).toBeChecked();
		await closeSettings(page);
		const keyed = await graphShot(page);
		expect(keyed.equals(plain)).toBe(false);

		// Turned off again, the graph is as it was.
		await openSettings(page);
		await keys.click();
		await closeSettings(page);
		expect((await graphShot(page)).equals(plain)).toBe(true);

		// A tab that was hidden while keys were turned on has them, and room for them, when shown.
		await page.getByRole('button', { name: 'New tab' }).click();
		await openSettings(page);
		await keys.click();
		await closeSettings(page);
		await page.getByRole('tab').first().click();
		await expect(page.getByText('5 nodes')).toBeVisible();
		expect((await graphShot(page)).equals(keyed)).toBe(true);
	});

	test('stops remembering tabs, forgetting those kept, once that is confirmed', async ({
		page
	}) => {
		await replaceSource(page, '{"kept": true}');
		await expect.poll(() => savedTabs(page)).toEqual([{ name: null, size: 14 }]);

		await openSettings(page);
		await page.getByRole('menuitemcheckbox', { name: 'Remember tabs in this browser' }).click();
		// Until the menu has faded out, the page takes no pointer events.
		await expect(page.getByRole('menu')).toBeHidden();
		const dialog = page.getByRole('alertdialog', { name: 'Stop remembering tabs?' });
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		expect(await savedTabs(page)).toEqual([{ name: null, size: 14 }]);

		await openSettings(page);
		await page.getByRole('menuitemcheckbox', { name: 'Remember tabs in this browser' }).click();
		await expect(page.getByRole('menu')).toBeHidden();
		await dialog.getByRole('button', { name: 'Stop remembering' }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByText('Tabs are not kept in this browser')).toBeVisible();
		await expect.poll(() => savedTabs(page)).toBeNull();

		// Nothing comes back, and nothing is kept, over a reload.
		await page.reload();
		await expect(page.getByRole('status')).toBeHidden();
		await expect(page.getByText(PLACEHOLDER)).toBeVisible();
		await replaceSource(page, '{"gone": true}');
		await expect(page.getByText('1 node')).toBeVisible();
		expect(await savedTabs(page)).toBeNull();

		// Turned on again, the tabs open then are kept.
		await openSettings(page);
		await page.getByRole('menuitemcheckbox', { name: 'Remember tabs in this browser' }).click();
		await expect(page.getByText('Tabs are kept in this browser')).toBeVisible();
		await expect.poll(() => savedTabs(page)).toEqual([{ name: null, size: 14 }]);
		await page.reload();
		await expect(page.locator('.cm-content')).toHaveText('{"gone": true}');
	});
});
