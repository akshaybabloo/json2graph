import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Replaces the whole text of the editor, as a paste would. */
async function replaceSource(page: Page, text: string) {
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

/** Opens the JSON example from the Example menu. */
async function openExample(page: Page) {
	await page.getByRole('button', { name: 'Example' }).click();
	await page.getByRole('menuitem', { name: 'JSON' }).click();
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

	// With the editor hidden, the page does not point to it.
	await page.getByRole('button', { name: 'Hide editor' }).click();
	await expect(page.getByText('Open a file, or drop one anywhere on the page.')).toBeVisible();
	await page.getByRole('button', { name: 'Show editor' }).click();
	await expect(page.getByText(/Type or paste JSON on the left/)).toBeVisible();
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

	await format.click();
	await expect(page.locator('.cm-line')).toHaveText(['{ "a": 1 }', '']);
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
		const editor = (await page.getByRole('region', { name: 'JSON source' }).boundingBox())!;
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
		const source = page.getByRole('region', { name: 'JSON source' });
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
		await expect(page.getByRole('region', { name: 'JSON source' })).toBeVisible();
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
