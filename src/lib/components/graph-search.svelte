<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	/** How long typing must pause before the graph is searched. */
	const SEARCH_DELAY = 150;

	/**
	 * A bar that finds text in the graph, as an editor's find does: what it
	 * found is counted, Enter goes to the next and Shift+Enter to the one
	 * before, and Escape closes it.
	 */
	let {
		text = $bindable(''),
		matchCase = $bindable(false),
		count,
		current,
		onsearch,
		onstep,
		onclose
	}: {
		/** What is searched for. */
		text?: string;
		/** Whether the case of what is found must match. */
		matchCase?: boolean;
		/** How many rows were found, and which of them was gone to; -1 for none. */
		count: number;
		current: number;
		/** Searches for `text`: as it is typed, once typing pauses. */
		onsearch: (text: string, matchCase: boolean) => void;
		/** Goes to the next row found, or with -1 to the one before. */
		onstep: (by: 1 | -1) => void;
		onclose: () => void;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const number = new Intl.NumberFormat();
	const status = $derived(
		!text
			? ''
			: count === 0
				? 'No results'
				: current < 0
					? `${number.format(count)} found`
					: `${number.format(current + 1)} of ${number.format(count)}`
	);

	/** Puts the cursor in the box, with what is in it selected to be typed over. */
	export function focus() {
		input?.focus();
		input?.select();
	}

	/** Searches once typing pauses. */
	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(search, SEARCH_DELAY);
	}

	function search() {
		clearTimeout(timer);
		timer = undefined;
		onsearch(text, matchCase);
	}

	function step(by: 1 | -1) {
		// Typed ahead of the search: it goes to the first row it finds.
		if (timer !== undefined) search();
		else onstep(by);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			onclose();
		} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			// Already open: the browser's own find could not see into the graph.
			focus();
		} else if (event.altKey && event.code === 'KeyC') {
			matchCase = !matchCase;
			search();
		} else {
			return;
		}
		event.preventDefault();
	}

	/** Takes the cursor when the bar opens; a search still waiting for typing to pause is dropped when it closes. */
	function opened(node: HTMLInputElement) {
		node.focus();
		return () => clearTimeout(timer);
	}
</script>

<search
	class="flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-xs"
	aria-label="Find in the graph"
>
	<InputGroup.Root class="h-8 w-60 min-w-0 shrink">
		<InputGroup.Input
			bind:ref={input}
			bind:value={text}
			placeholder="Find"
			aria-label="Find in the graph"
			aria-describedby="graph-search-status"
			autocomplete="off"
			spellcheck="false"
			oninput={schedule}
			{onkeydown}
			{@attach opened}
		/>
		<InputGroup.Addon>
			<SearchIcon />
		</InputGroup.Addon>
		<InputGroup.Addon align="inline-end">
			<InputGroup.Text
				id="graph-search-status"
				class="text-xs whitespace-nowrap tabular-nums"
				aria-live="polite"
			>
				{status}
			</InputGroup.Text>
		</InputGroup.Addon>
	</InputGroup.Root>
	<div class="flex items-center gap-2 px-2">
		<Checkbox
			id="graph-search-case"
			checked={matchCase}
			aria-keyshortcuts="Alt+C"
			onCheckedChange={(checked) => {
				matchCase = checked;
				search();
			}}
		/>
		<Label for="graph-search-case" class="text-xs whitespace-nowrap">Match case</Label>
	</div>
	{@render iconButton(
		'Previous match',
		'Previous match (Shift+Enter)',
		ChevronUpIcon,
		() => step(-1),
		count === 0
	)}
	{@render iconButton(
		'Next match',
		'Next match (Enter)',
		ChevronDownIcon,
		() => step(1),
		count === 0
	)}
	{@render iconButton('Close the search', 'Close (Escape)', XIcon, onclose)}
</search>

{#snippet iconButton(
	label: string,
	tip: string,
	Icon: typeof XIcon,
	onclick: () => void,
	disabled = false
)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon-sm" aria-label={label} {disabled} {onclick}>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{tip}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}
