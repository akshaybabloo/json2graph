<script lang="ts">
	import ChartLineIcon from '@lucide/svelte/icons/chart-line';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as ContextMenu from '#lib/components/ui/context-menu/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { isPlottable } from '#lib/csv/columns.js';
	import { columnNames, parseRecord } from '#lib/csv/csv.js';
	import { choosePlot, firstPlot, type PlotChoice } from '#lib/csv/plot.js';
	import type { Rows, RowsRequest } from '#lib/csv/rows-worker.js';
	import { cn } from '#lib/utils.js';

	type Props = {
		/** The CSV text, or none when it is too large to be held as text. */
		text: string | null;
		/** Plots columns of the table, chosen from its right-click menu. */
		onplot: (choice: PlotChoice) => void;
	};

	let { text, onplot }: Props = $props();

	/** Heights of a row and of the header, border included: the text is centred by its line height. */
	const ROW_HEIGHT = 28;
	const HEADER_HEIGHT = 32;
	/**
	 * The tallest the scrolled content is made. Browsers cap the height of an
	 * element at a few million pixels; beyond this, the scroll position is
	 * scaled to the rows.
	 */
	const MAX_SCROLL = 8_000_000;
	/** How many rows the width of a column is measured over. */
	const SAMPLE_ROWS = 200;
	const MIN_CHARS = 4;
	/** The widest a column starts, and the widest that fitting it to its text makes it. */
	const MAX_CHARS = 40;
	const FIT_CHARS = 200;
	/** How much the arrow keys widen or narrow a column. */
	const KEY_STEP = 2;

	/**
	 * Where the records start, once the worker has found them, with the text
	 * they were found in: until it finds them in a newer text, the table shows
	 * the one it has them for.
	 */
	let rows = $state.raw<(Rows & { text: string }) | null>(null);
	let scrollTop = $state(0);
	let viewHeight = $state(0);

	let worker: Worker | undefined;
	let asked = 0;

	$effect(() => {
		const source = text;
		if (source === null) {
			rows = null;
			return;
		}
		worker ??= new Worker(new URL('../csv/rows-worker.ts', import.meta.url), { type: 'module' });
		const id = ++asked;
		worker.onmessage = (event: MessageEvent<Rows>) => {
			if (event.data.id === asked) rows = { ...event.data, text: source };
		};
		worker.postMessage({ id, text: source } satisfies RowsRequest);
	});

	$effect(() => () => worker?.terminate());

	/** The fields of record `index`, the header being record 0. */
	function record(index: number): string[] {
		if (!rows) return [];
		const end = index + 1 < rows.starts.length ? rows.starts[index + 1] : rows.text.length;
		return parseRecord(rows.text.slice(rows.starts[index], end), rows.delimiter);
	}

	const header = $derived(rows ? columnNames(record(0)) : []);
	/** Rows of data: the records after the header. */
	const rowCount = $derived(rows ? Math.max(0, rows.starts.length - 1) : 0);

	/** The columns chosen by their names, in the order they were chosen. */
	let selected = $state<number[]>([]);
	/** The column a range chosen with Shift starts from. */
	let anchor = 0;

	// Columns of another table are not chosen.
	$effect(() => {
		header.join('\n');
		selected = [];
	});

	/**
	 * Chooses a column, as a spreadsheet does: alone, or with Ctrl or ⌘ added
	 * to those chosen or taken from them, or with Shift those from the last
	 * one chosen up to it.
	 */
	function select(event: MouseEvent, column: number) {
		if (event.shiftKey) {
			const [from, to] = anchor < column ? [anchor, column] : [column, anchor];
			const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
			selected = [...selected.filter((c) => !range.includes(c)), ...range];
			return;
		}
		anchor = column;
		if (event.ctrlKey || event.metaKey) {
			selected = selected.includes(column)
				? selected.filter((c) => c !== column)
				: [...selected, column];
		} else {
			selected = selected.length === 1 && selected[0] === column ? [] : [column];
		}
	}

	/** A column right-clicked that is not among those chosen is chosen alone, as the menu is for it. */
	function selectForMenu(column: number) {
		if (selected.includes(column)) return;
		selected = [column];
		anchor = column;
	}

	const plottable = $derived(selected.filter((column) => isPlottable(rows?.kinds[column])));
	const unplottable = $derived(selected.filter((column) => !isPlottable(rows?.kinds[column])));

	/**
	 * A plot of the columns chosen that can be plotted, or else of the first
	 * few; none until the rows are read.
	 */
	export function plotChoice(): PlotChoice | null {
		if (!rows) return null;
		return plottable.length > 0 ? choosePlot(rows.kinds, plottable) : firstPlot(rows.kinds);
	}

	/** How wide the text of each column is, in characters, in its name and its first rows. */
	const fitted = $derived.by(() => {
		const chars = header.map((name) => name.length);
		for (let row = 1; row <= Math.min(rowCount, SAMPLE_ROWS); row++) {
			record(row).forEach((field, column) => {
				chars[column] = Math.max(chars[column] ?? 0, line(field).length);
			});
		}
		return chars.map((n) => Math.min(Math.max(n, MIN_CHARS), FIT_CHARS));
	});

	/**
	 * Widths the user gave columns, by place and name: a column that moves or
	 * is renamed starts again from its text.
	 */
	let resized = $state<Record<string, number>>({});

	function columnKey(column: number): string {
		return `${column}\n${header[column]}`;
	}

	/** How wide each column is, in characters. */
	const widths = $derived(
		fitted.map((chars, column) => resized[columnKey(column)] ?? Math.min(chars, MAX_CHARS))
	);

	/** How wide a hundred characters are, to turn a drag in pixels into characters. */
	let hundredChars = $state(0);
	let drag: { column: number; x: number; width: number } | null = null;

	function setWidth(column: number, chars: number) {
		resized[columnKey(column)] = Math.min(Math.max(chars, MIN_CHARS), FIT_CHARS);
	}

	function startResize(event: PointerEvent & { currentTarget: HTMLElement }, column: number) {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = { column, x: event.clientX, width: widths[column] };
	}

	function moveResize(event: PointerEvent) {
		if (!drag || hundredChars === 0) return;
		setWidth(drag.column, drag.width + ((event.clientX - drag.x) * 100) / hundredChars);
	}

	function resizeKey(event: KeyboardEvent, column: number) {
		const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
		if (step === undefined) return;
		event.preventDefault();
		setWidth(column, widths[column] + step);
	}
	const digits = $derived(String(rowCount).length);
	/** How wide the whole table is: its columns, each with its padding. */
	const tableWidth = $derived(
		`calc(${digits + 2 + widths.reduce((sum, chars) => sum + chars, 0)}ch + ${widths.length}rem)`
	);

	/** A field that does not fit its column, opened in full. */
	let detail = $state.raw<{ anchor: HTMLElement; name: string; text: string } | null>(null);
	let detailOpen = $state(false);

	function openDetail(
		event: MouseEvent & { currentTarget: HTMLElement },
		column: number,
		text: string
	) {
		detail = { anchor: event.currentTarget, name: header[column], text };
		detailOpen = true;
	}

	const rowsHeight = $derived(Math.max(0, viewHeight - HEADER_HEIGHT));
	const contentHeight = $derived(rowCount * ROW_HEIGHT);
	const scrolledHeight = $derived(Math.min(contentHeight, MAX_SCROLL));
	/** Where the rows on screen begin, in pixels of the whole table. */
	const position = $derived.by(() => {
		const scrollRange = scrolledHeight - rowsHeight;
		if (scrollRange <= 0) return 0;
		return (Math.min(scrollTop, scrollRange) / scrollRange) * (contentHeight - rowsHeight);
	});
	const first = $derived(Math.floor(position / ROW_HEIGHT));
	const shown = $derived.by(() => {
		const last = Math.min(rowCount, first + Math.ceil(rowsHeight / ROW_HEIGHT) + 1);
		return Array.from({ length: Math.max(0, last - first) }, (_, i) => {
			const fields = record(first + i + 1);
			// A field for every column, empty where the record has none.
			return { index: first + i, cells: header.map((_, column) => fields[column] ?? '') };
		});
	});

	/** A field as one line. */
	function line(field: string): string {
		return field.replace(/\r\n|\r|\n/g, ' ↵ ');
	}
</script>

{#if text === null}
	<p class="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
		The table shows files of up to 100 MB. The graph shows the whole file.
	</p>
{:else if !rows}
	<p
		class="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
		role="status"
	>
		<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
		Reading the rows…
	</p>
{:else}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<!-- The scroller only gives the size of the table: the rows on screen are drawn where it is. -->
				<div
					{...props}
					class="relative h-full overflow-auto font-mono text-xs"
					data-scroller
					bind:clientHeight={viewHeight}
					onscroll={(event) => {
						scrollTop = event.currentTarget.scrollTop;
						// What it was opened from moves away.
						detailOpen = false;
					}}
				>
					<span
						class="pointer-events-none invisible absolute block"
						style:width="100ch"
						bind:clientWidth={hundredChars}
					></span>
					<div
						class="min-w-full"
						style:width="max-content"
						style:height="{HEADER_HEIGHT + Math.max(scrolledHeight, rowsHeight)}px"
					>
						<div class="sticky top-0 overflow-hidden" style:height="{viewHeight}px">
							<Table.Root
								class="table-fixed text-xs"
								style="width: {tableWidth}"
								aria-label="Rows"
								aria-rowcount={rowCount + 1}
							>
								<colgroup>
									<col style:width="{digits + 2}ch" />
									{#each widths as chars, column (column)}
										<col style:width="calc({chars}ch + 1rem)" />
									{/each}
								</colgroup>
								<!-- Above the rows, which slide under it as they scroll away. -->
								<Table.Header class="relative z-10 bg-muted">
									<Table.Row
										class="hover:bg-muted"
										style="height: {HEADER_HEIGHT}px; line-height: {HEADER_HEIGHT - 1}px"
										aria-rowindex={1}
									>
										<Table.Head class="h-auto px-2 text-right text-muted-foreground">#</Table.Head>
										{#each header as name, column (column)}
											{@const chosen = selected.includes(column)}
											<Table.Head
												class={cn('relative h-auto p-0', chosen && 'bg-foreground/10')}
												aria-selected={chosen}
											>
												<!-- Clicked to choose the column, for its right-click menu. -->
												<button
													class="block h-full w-full cursor-pointer truncate px-2 text-left outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
													title={name}
													aria-pressed={chosen}
													onclick={(event) => select(event, column)}
													oncontextmenu={() => selectForMenu(column)}
												>
													{name}
												</button>
												<!-- Dragged to widen the column, or double-clicked to fit it to its text. -->
												<span
													class="absolute inset-y-0 right-0 w-2 cursor-col-resize outline-none hover:bg-ring/40 focus-visible:bg-ring/60"
													role="slider"
													aria-orientation="horizontal"
													aria-label="Width of {name}"
													aria-valuenow={Math.round(widths[column])}
													aria-valuemin={MIN_CHARS}
													aria-valuemax={FIT_CHARS}
													tabindex="0"
													onpointerdown={(event) => startResize(event, column)}
													onpointermove={moveResize}
													onpointerup={() => (drag = null)}
													ondblclick={() => setWidth(column, fitted[column])}
													onkeydown={(event) => resizeKey(event, column)}
												></span>
											</Table.Head>
										{/each}
									</Table.Row>
								</Table.Header>
								<Table.Body style="transform: translateY({first * ROW_HEIGHT - position}px)">
									{#each shown as row (row.index)}
										<Table.Row
											style="height: {ROW_HEIGHT}px; line-height: {ROW_HEIGHT - 1}px"
											aria-rowindex={row.index + 2}
										>
											<Table.Cell class="px-2 py-0 text-right text-muted-foreground">
												{row.index + 1}
											</Table.Cell>
											{#each row.cells as field, column (column)}
												{@const oneLine = line(field)}
												<Table.Cell
													class={cn(
														'truncate px-2 py-0',
														selected.includes(column) && 'bg-foreground/5'
													)}
													oncontextmenu={() => selectForMenu(column)}
												>
													{#if oneLine.length > widths[column]}
														<!-- Cut short: clicked, it opens in full. -->
														<button
															class="block w-full cursor-pointer truncate text-left outline-ring hover:underline focus-visible:outline-2"
															onclick={(event) => openDetail(event, column, field)}
														>
															{oneLine}
														</button>
													{:else}
														{oneLine}
													{/if}
												</Table.Cell>
											{/each}
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					</div>
				</div>
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-60">
			<ContextMenu.Item
				disabled={plottable.length === 0}
				onSelect={() => onplot(choosePlot(rows?.kinds ?? [], plottable))}
			>
				<ChartLineIcon />
				{#if plottable.length > 1}
					Plot {plottable.length} columns
				{:else if plottable.length === 1}
					<span class="truncate">Plot {header[plottable[0]]}</span>
				{:else}
					Plot
				{/if}
			</ContextMenu.Item>
			{#if selected.length === 0}
				<p class="px-2 py-1.5 text-xs text-muted-foreground">
					Click the name of a column to choose it; Ctrl or Shift chooses more.
				</p>
			{:else if unplottable.length > 0}
				<p class="px-2 py-1.5 text-xs text-muted-foreground">
					{unplottable.length === 1
						? `${header[unplottable[0]]} holds text, so it is not plotted.`
						: `${unplottable.length} of the columns chosen hold text, so they are not plotted.`}
				</p>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>

	<Popover.Root bind:open={detailOpen}>
		<Popover.Content
			customAnchor={detail?.anchor ?? null}
			role="dialog"
			aria-label="Full text of {detail?.name}"
			side="bottom"
			align="start"
			class="max-h-72 w-auto max-w-md gap-1 overflow-auto p-3"
		>
			{#if detail}
				<p class="text-xs font-medium text-muted-foreground">{detail.name}</p>
				<p class="font-mono text-xs break-words whitespace-pre-wrap select-text">{detail.text}</p>
			{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
