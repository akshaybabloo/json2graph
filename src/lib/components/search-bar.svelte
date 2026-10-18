<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ReplaceIcon from '@lucide/svelte/icons/replace';
	import ReplaceAllIcon from '@lucide/svelte/icons/replace-all';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SquareDashedTextIcon from '@lucide/svelte/icons/square-dashed-text';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import type { ClassValue } from 'svelte/elements';

	/** How long typing must pause before what is typed is searched for. */
	const SEARCH_DELAY = 150;

	/**
	 * A bar that finds text, as an editor's find does: what it found is
	 * counted, Enter goes to the next and Shift+Enter to the one before, and
	 * Escape closes it. The graph and the code each search with it; an option
	 * left out is not offered, and nothing is replaced without `replacement`.
	 */
	let {
		label,
		text = $bindable(''),
		matchCase = $bindable(false),
		regexp = $bindable(),
		wholeWord = $bindable(),
		replacement = $bindable(),
		replacing = $bindable(false),
		count,
		current,
		more = false,
		invalid = false,
		delay = SEARCH_DELAY,
		class: className,
		onsearch,
		onstep,
		onclose,
		onselectall,
		onreplace,
		onreplaceall,
		onkey
	}: {
		/** What is searched, as the bar and its box are called: "Find in the graph". */
		label: string;
		/** What is searched for. */
		text?: string;
		/** Whether the case of what is found must match. */
		matchCase?: boolean;
		/** Whether `text` is a regular expression. */
		regexp?: boolean;
		/** Whether only whole words are found. */
		wholeWord?: boolean;
		/** What what is found is replaced with. */
		replacement?: string;
		/** Whether the box of the replacement is shown. */
		replacing?: boolean;
		/** How many were found, and which of them was gone to; -1 for none. */
		count: number;
		current: number;
		/** Whether more than `count` were found: they are still being counted, or too many to. */
		more?: boolean;
		/** Whether `text` is not a regular expression that can be searched for. */
		invalid?: boolean;
		/** How long typing must pause before `onsearch`, in milliseconds. */
		delay?: number;
		class?: ClassValue;
		/** Searches for `text`, with the options as they are: as it is typed, once typing pauses. */
		onsearch: () => void;
		/** Goes to the next one found, or with -1 to the one before. */
		onstep: (by: 1 | -1) => void;
		onclose: () => void;
		/** Selects everything found. */
		onselectall?: () => void;
		/** Replaces the one gone to, and goes to the next. */
		onreplace?: () => void;
		onreplaceall?: () => void;
		/** Any other key pressed in the bar; true if it was acted on. */
		onkey?: (event: KeyboardEvent) => boolean;
	} = $props();

	const id = $props.id();
	let input = $state<HTMLInputElement | null>(null);
	let replaceInput = $state<HTMLInputElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const canReplace = $derived(replacement !== undefined);
	const none = $derived(count === 0 && !more);

	const number = new Intl.NumberFormat();
	const status = $derived.by(() => {
		if (!text) return '';
		if (invalid) return 'Invalid pattern';
		if (none) return 'No results';
		const total = `${number.format(count)}${more ? '+' : ''}`;
		if (count === 0) return 'Searching…';
		return current < 0 ? `${total} found` : `${number.format(current + 1)} of ${total}`;
	});

	/** Puts the cursor in the box, with what is in it selected to be typed over. */
	export function focus() {
		input?.focus();
		input?.select();
	}

	/** Shows the box of the replacement, with the cursor in it. */
	export function showReplace() {
		if (!canReplace) return;
		replacing = true;
		// Once it is shown.
		queueMicrotask(() => {
			replaceInput?.focus();
			replaceInput?.select();
		});
	}

	/** Searches once typing pauses. */
	function schedule() {
		clearTimeout(timer);
		if (delay > 0) timer = setTimeout(search, delay);
		else search();
	}

	function search() {
		clearTimeout(timer);
		timer = undefined;
		onsearch();
	}

	function step(by: 1 | -1) {
		// Typed ahead of the search: it goes to the first one it finds.
		if (timer !== undefined) search();
		else onstep(by);
	}

	/** The keys of both boxes; in that of the replacement, Enter replaces. */
	function keydown(event: KeyboardEvent, inReplace: boolean) {
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();
		if (event.key === 'Enter' && inReplace) {
			if (mod && event.altKey) onreplaceall?.();
			else onreplace?.();
		} else if (event.key === 'Enter' && event.altKey && onselectall) {
			onselectall();
		} else if (event.key === 'Enter') {
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			onclose();
		} else if (mod && event.shiftKey && key === 'f' && canReplace) {
			showReplace();
		} else if (mod && key === 'f') {
			// Already open: the browser's own find could not see into the graph or the code.
			focus();
		} else if (event.altKey && event.code === 'KeyC') {
			matchCase = !matchCase;
			search();
		} else if (event.altKey && event.code === 'KeyR' && regexp !== undefined) {
			regexp = !regexp;
			search();
		} else if (event.altKey && event.code === 'KeyW' && wholeWord !== undefined) {
			wholeWord = !wholeWord;
			search();
		} else if (!onkey?.(event)) {
			return;
		}
		event.preventDefault();
	}

	/**
	 * Takes the cursor when the bar opens; a search still waiting for typing
	 * to pause is dropped when it closes. CodeMirror finds the box to focus by
	 * its `main-field`.
	 */
	function opened(node: HTMLInputElement) {
		node.setAttribute('main-field', 'true');
		node.focus();
		return () => clearTimeout(timer);
	}
</script>

<search class={['flex flex-col gap-1', className]} aria-label={label}>
	<div class="flex items-center gap-1">
		{#if canReplace}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-sm"
							aria-label="Toggle replace"
							aria-expanded={replacing}
							aria-controls={replacing ? `${id}-replace` : undefined}
							onclick={() => (replacing ? (replacing = false) : showReplace())}
						>
							<ChevronRightIcon class={['transition-transform', replacing && 'rotate-90']} />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Replace (Ctrl+Shift+F)</Tooltip.Content>
			</Tooltip.Root>
		{/if}
		<InputGroup.Root class="h-8 min-w-0 flex-1">
			<InputGroup.Input
				bind:ref={input}
				bind:value={text}
				placeholder="Find"
				aria-label={label}
				aria-describedby="{id}-status"
				aria-invalid={invalid || undefined}
				autocomplete="off"
				spellcheck="false"
				oninput={schedule}
				onkeydown={(event) => keydown(event, false)}
				{@attach opened}
			/>
			<InputGroup.Addon>
				<SearchIcon />
			</InputGroup.Addon>
			<InputGroup.Addon align="inline-end">
				<InputGroup.Text
					id="{id}-status"
					class="text-xs whitespace-nowrap tabular-nums"
					aria-live="polite"
				>
					{status}
				</InputGroup.Text>
			</InputGroup.Addon>
		</InputGroup.Root>
		{@render iconButton('Previous match', 'Shift+Enter', ChevronUpIcon, () => step(-1), none)}
		{@render iconButton('Next match', 'Enter', ChevronDownIcon, () => step(1), none)}
		{#if onselectall}
			{@render iconButton(
				'Select all matches',
				'Alt+Enter',
				SquareDashedTextIcon,
				onselectall,
				none
			)}
		{/if}
		{@render iconButton('Close the search', 'Escape', XIcon, onclose)}
	</div>
	<div class={['flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-0.5', canReplace && 'pl-10']}>
		{@render option('case', 'Match case', 'Alt+C', matchCase, (on) => (matchCase = on))}
		{#if regexp !== undefined}
			{@render option('regexp', 'Regular expression', 'Alt+R', regexp, (on) => (regexp = on))}
		{/if}
		{#if wholeWord !== undefined}
			{@render option('word', 'Whole word', 'Alt+W', wholeWord, (on) => (wholeWord = on))}
		{/if}
	</div>
	{#if canReplace && replacing}
		<div id="{id}-replace" class="flex items-center gap-1 pl-9">
			<InputGroup.Root class="h-8 min-w-0 flex-1">
				<InputGroup.Input
					bind:ref={replaceInput}
					bind:value={replacement}
					placeholder="Replace"
					aria-label="Replace with"
					autocomplete="off"
					spellcheck="false"
					oninput={search}
					onkeydown={(event) => keydown(event, true)}
				/>
			</InputGroup.Root>
			{@render iconButton('Replace', 'Enter', ReplaceIcon, () => onreplace?.(), none)}
			{@render iconButton(
				'Replace all',
				'Ctrl+Alt+Enter',
				ReplaceAllIcon,
				() => onreplaceall?.(),
				none
			)}
		</div>
	{/if}
</search>

{#snippet option(
	name: string,
	caption: string,
	keys: string,
	checked: boolean,
	set: (on: boolean) => void
)}
	<div class="flex items-center gap-2">
		<Checkbox
			id="{id}-{name}"
			{checked}
			aria-keyshortcuts={keys}
			onCheckedChange={(on) => {
				set(on);
				search();
			}}
		/>
		<Label for="{id}-{name}" class="text-xs font-normal whitespace-nowrap">{caption}</Label>
	</div>
{/snippet}

{#snippet iconButton(
	label: string,
	keys: string,
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
		<Tooltip.Content>{label} ({keys})</Tooltip.Content>
	</Tooltip.Root>
{/snippet}
