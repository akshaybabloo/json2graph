<script lang="ts">
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import ChartLineIcon from '@lucide/svelte/icons/chart-line';
	import ChartScatterIcon from '@lucide/svelte/icons/chart-scatter';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { BOOLEAN_LEVELS } from '#lib/csv/columns.js';
	import type { ColumnsReply, ColumnsRequest } from '#lib/csv/columns-worker.js';
	import { acrossName, plotly, traces, type Chart, type PlotChoice } from '#lib/csv/plot.js';
	import type { Config, Data, Layout } from 'plotly.js';
	import { untrack } from 'svelte';

	type Props = {
		/** The CSV text, or none when it is too large to be held as text. */
		text: string | null;
		/** What is plotted, which the toolbar changes. */
		choice: PlotChoice;
		/** What an image of the plot is named after. */
		name: string;
		/** Whether the plot is all that is shown. */
		alone: boolean;
		/** The plot is to be all that is shown, or no longer. */
		onalone: () => void;
		/** The plot is to be hidden. */
		onhide: () => void;
	};

	let { text, choice = $bindable(), name, alone, onalone, onhide }: Props = $props();

	const CHARTS = [
		{ value: 'line', label: 'Line', Icon: ChartLineIcon },
		{ value: 'scatter', label: 'Points', Icon: ChartScatterIcon },
		{ value: 'bar', label: 'Bars', Icon: ChartColumnIcon }
	] as const;
	/** What the menu of what goes across calls the number of the row. */
	const ROW = 'row';

	/** The columns of the text, once the worker has read them. */
	let columns = $state.raw<ColumnsReply | null>(null);
	let worker: Worker | undefined;
	let asked = 0;

	$effect(() => {
		const source = text;
		if (source === null) {
			columns = null;
			return;
		}
		worker ??= new Worker(new URL('../csv/columns-worker.ts', import.meta.url), {
			type: 'module'
		});
		const id = ++asked;
		worker.onmessage = (event: MessageEvent<ColumnsReply>) => {
			if (event.data.id === asked) columns = event.data;
		};
		worker.postMessage({ id, text: source } satisfies ColumnsRequest);
	});

	$effect(() => () => worker?.terminate());

	/** The colours and font of the page, which the plot is drawn in. */
	type Look = {
		font: string;
		foreground: string;
		muted: string;
		border: string;
		popover: string;
		popoverForeground: string;
	};

	let element: HTMLDivElement;
	let look = $state.raw<Look | null>(null);
	let failed = $state<string | null>(null);
	/** Whether Plotly has drawn into the element, which then has to be freed. */
	let drawn = $state(false);
	let draws = 0;

	function readLook(): Look {
		const style = getComputedStyle(element);
		const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
		return {
			font: style.fontFamily,
			foreground: token('foreground'),
			muted: token('muted-foreground'),
			border: token('border'),
			popover: token('popover'),
			popoverForeground: token('popover-foreground')
		};
	}

	// The theme is switched by toggling a class on the root element; the plot is drawn again in it.
	$effect(() => {
		look = readLook();
		const observer = new MutationObserver(() => (look = readLook()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});

	const data = $derived(columns ? traces(columns, choice) : []);
	const chart = $derived(CHARTS.find((c) => c.value === choice.chart) ?? CHARTS[0]);

	$effect(() => {
		if (!columns || !look || data.length === 0) return;
		const across = acrossName(columns.columns, choice);
		const up = choice.y.length === 1 ? columns.columns[choice.y[0]]?.name : undefined;
		const booleans = choice.y.every((place) => columns!.columns[place]?.kind === 'boolean');
		const shown = layout(look, across, up, booleans, choice.chart === 'scatter', `${choice.x}`);
		const file = name;
		untrack(() => draw(data, shown, file));
	});

	/**
	 * How the plot looks, in the `look` of the page, up a scale of true and
	 * false when only `booleans` are plotted: `kept` changes when the zoom
	 * should not be kept.
	 */
	function layout(
		look: Look,
		across: string,
		up: string | undefined,
		booleans: boolean,
		scatter: boolean,
		kept: string
	) {
		const { foreground, muted, border } = look;
		const axis = { gridcolor: border, linecolor: border, zerolinecolor: border, automargin: true };
		return {
			paper_bgcolor: 'rgba(0, 0, 0, 0)',
			plot_bgcolor: 'rgba(0, 0, 0, 0)',
			font: { family: look.font, color: foreground, size: 12 },
			margin: { t: 32, r: 16, b: 8, l: 8 },
			xaxis: { ...axis, title: { text: across } },
			yaxis: {
				...axis,
				title: { text: up ?? '' },
				...(booleans && {
					tickvals: Object.values(BOOLEAN_LEVELS),
					ticktext: Object.keys(BOOLEAN_LEVELS)
				})
			},
			legend: { orientation: 'h', x: 0, y: 1, yanchor: 'bottom' },
			hovermode: scatter ? 'closest' : 'x unified',
			hoverlabel: {
				bgcolor: look.popover,
				bordercolor: border,
				font: { color: look.popoverForeground }
			},
			modebar: { bgcolor: 'rgba(0, 0, 0, 0)', color: muted, activecolor: foreground },
			// Zoomed in, the plot stays so as columns are added or the theme changes.
			uirevision: kept
		} satisfies Partial<Layout>;
	}

	async function draw(data: Data[], layout: Partial<Layout>, file: string) {
		const id = ++draws;
		const config: Partial<Config> = {
			displaylogo: false,
			modeBarButtonsToRemove: ['select2d', 'lasso2d'],
			toImageButtonOptions: { filename: file }
		};
		try {
			const api = await plotly();
			if (id !== draws) return;
			await api.react(element, data, layout, config);
			drawn = true;
			failed = null;
		} catch (error) {
			if (id === draws) failed = error instanceof Error ? error.message : String(error);
		}
	}

	// Plotly sizes the plot to the element only when told to.
	$effect(() => {
		const observer = new ResizeObserver(() => {
			if (drawn) plotly().then((api) => api.Plots.resize(element));
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			if (drawn) plotly().then((api) => api.purge(element));
		};
	});

	/** `n` as an ordinal: 2nd, 4th, 21st. */
	function ordinal(n: number): string {
		const tens = n % 100;
		if (tens >= 11 && tens <= 13) return `${n}th`;
		return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
	}

	const numberColumns = $derived(
		columns?.columns.flatMap((column, place) => (column.numbers ? [{ ...column, place }] : [])) ??
			[]
	);
</script>

<div class="flex h-full flex-col">
	<div class="flex min-w-0 items-center gap-1 border-b px-2 py-1 text-xs">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'xs' })}
				aria-label="Chart: {chart.label}"
			>
				<chart.Icon />
				{chart.label}
				<ChevronDownIcon class="text-muted-foreground" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				<DropdownMenu.RadioGroup
					value={choice.chart}
					onValueChange={(value) => (choice.chart = value as Chart)}
				>
					{#each CHARTS as { value, label, Icon } (value)}
						<DropdownMenu.RadioItem {value} closeOnSelect>
							<Icon />
							{label}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{#if columns}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'xs' })}>
					<span class="text-muted-foreground">Across</span>
					<span class="max-w-32 truncate">{acrossName(columns.columns, choice)}</span>
					<ChevronDownIcon class="text-muted-foreground" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-80 w-56">
					<DropdownMenu.RadioGroup
						value={choice.x === null ? ROW : String(choice.x)}
						onValueChange={(value) => (choice.x = value === ROW ? null : Number(value))}
					>
						<DropdownMenu.RadioItem value={ROW} closeOnSelect
							>Number of the row</DropdownMenu.RadioItem
						>
						<DropdownMenu.Separator />
						{#each columns.columns as column, place (place)}
							<DropdownMenu.RadioItem value={String(place)} closeOnSelect>
								<span class="truncate">{column.name}</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'xs' })}>
					<span class="text-muted-foreground">Up</span>
					<span class="max-w-40 truncate">
						{choice.y.length === 1
							? columns.columns[choice.y[0]]?.name
							: `${choice.y.length} columns`}
					</span>
					<ChevronDownIcon class="text-muted-foreground" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="max-h-80 w-56">
					{#each numberColumns as column (column.place)}
						<DropdownMenu.CheckboxItem
							checked={choice.y.includes(column.place)}
							closeOnSelect={false}
							onCheckedChange={(checked) =>
								(choice.y = checked
									? [...choice.y, column.place]
									: choice.y.filter((place) => place !== column.place))}
						>
							<span class="truncate">{column.name}</span>
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if columns.step > 1}
				<p class="truncate text-muted-foreground">
					Every {ordinal(columns.step)} of {columns.rows.toLocaleString()} rows
				</p>
			{/if}
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'icon-xs', class: 'ml-auto' })}
				aria-label="Show only the plot"
				aria-pressed={alone}
				onclick={onalone}
			>
				{#if alone}
					<Minimize2Icon />
				{:else}
					<Maximize2Icon />
				{/if}
			</Tooltip.Trigger>
			<Tooltip.Content>{alone ? 'Show the rest again' : 'Show only the plot'}</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
				aria-label="Hide the plot"
				onclick={onhide}
			>
				<XIcon />
			</Tooltip.Trigger>
			<Tooltip.Content>Hide the plot</Tooltip.Content>
		</Tooltip.Root>
	</div>
	<div class="relative min-h-0 flex-1">
		<div bind:this={element} class="absolute inset-0" data-plot></div>
		{#if text === null}
			<p
				class="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground"
			>
				The plot is drawn for files of up to 100 MB.
			</p>
		{:else if failed}
			<p
				class="absolute inset-0 grid place-items-center p-6 text-center text-sm text-destructive"
				role="alert"
			>
				The plot could not be drawn: {failed}.
			</p>
		{:else if !columns}
			<p
				class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
				role="status"
			>
				<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
				Reading the columns…
			</p>
		{:else if data.length > 0 && !drawn}
			<p
				class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
				role="status"
			>
				<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
				Drawing the plot…
			</p>
		{:else if data.length === 0}
			<p
				class="absolute inset-0 grid place-items-center bg-background p-6 text-center text-sm text-muted-foreground"
			>
				No column of numbers is chosen. Choose one from Up, or right-click a column of the table.
			</p>
		{/if}
	</div>
</div>
