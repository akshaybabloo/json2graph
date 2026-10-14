<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { tabLabel, type Tab } from '#lib/workspace.js';

	type Props = {
		tabs: Tab[];
		/** Id of the tab on screen. */
		active: number;
		/** Id of the element the tabs show. */
		controls: string;
		onselect: (id: number) => void;
		onclose: (id: number) => void;
		onrename: (id: number, name: string) => void;
		onnew: () => void;
	};

	let { tabs, active, controls, onselect, onclose, onrename, onnew }: Props = $props();

	/** Id of the tab whose name is being edited. */
	let renaming = $state<number | null>(null);

	/**
	 * Ends the editing of a name, keeping `name` unless it is blank. Focus goes
	 * back to the tab when the name was ended from the keyboard.
	 */
	async function finish(id: number, name: string | null, refocus: boolean) {
		// The field can lose focus as it goes away, after it was already ended.
		if (renaming !== id) return;
		renaming = null;
		if (name?.trim()) onrename(id, name.trim());
		if (!refocus) return;
		await tick();
		document.getElementById(`tab-${id}`)?.focus();
	}

	function onRenameKey(event: KeyboardEvent & { currentTarget: HTMLInputElement }, id: number) {
		// Not the keys of the tabs.
		event.stopPropagation();
		if (event.key === 'Enter') finish(id, event.currentTarget.value, true);
		else if (event.key === 'Escape') finish(id, null, true);
	}

	function focusAndSelect(input: HTMLInputElement) {
		input.focus();
		input.select();
	}

	/**
	 * The arrow keys, Home and End move between the tabs, and Enter or Space
	 * shows the one with focus: showing a tab reads its document again, which
	 * is not something to do for every tab passed on the way. Delete closes it,
	 * and F2 renames it.
	 */
	function onkeydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
		const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')];
		const at = buttons.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		let next: number;
		switch (event.key) {
			case 'ArrowLeft':
				next = (at - 1 + buttons.length) % buttons.length;
				break;
			case 'ArrowRight':
				next = (at + 1) % buttons.length;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = buttons.length - 1;
				break;
			case 'Delete':
				event.preventDefault();
				onclose(tabs[at].id);
				return;
			case 'F2':
				event.preventDefault();
				renaming = tabs[at].id;
				return;
			default:
				return;
		}
		event.preventDefault();
		buttons[next].focus();
	}
</script>

<div class="flex items-end gap-1 border-b bg-muted/40 px-2 pt-2">
	<div
		class="-mb-px flex min-w-0 items-end gap-1 overflow-x-auto"
		role="tablist"
		aria-label="Documents"
		tabindex="-1"
		{onkeydown}
	>
		{#each tabs as tab (tab.id)}
			{@const selected = tab.id === active}
			<div
				class={[
					'flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 text-sm',
					selected
						? 'bg-background text-foreground'
						: 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
					// Faded like a tab a browser has put to sleep.
					tab.discarded && 'opacity-50 hover:opacity-100'
				]}
			>
				{#if renaming === tab.id}
					<input
						{@attach focusAndSelect}
						class="mr-2 ml-1.5 field-sizing-content h-7 max-w-56 min-w-16 rounded-sm border bg-background px-1.5 outline-ring focus-visible:outline-2"
						aria-label="Name of the tab"
						value={tabLabel(tab)}
						onkeydown={(event) => onRenameKey(event, tab.id)}
						onblur={(event) => finish(tab.id, event.currentTarget.value, false)}
					/>
				{:else}
					<button
						id="tab-{tab.id}"
						class="h-full max-w-56 truncate rounded-tl-lg pr-2 pl-3 outline-ring focus-visible:outline-2"
						role="tab"
						aria-selected={selected}
						aria-controls={selected ? controls : undefined}
						tabindex={selected ? 0 : -1}
						title={tab.discarded
							? `${tabLabel(tab)}: freed to save memory, and read again when shown`
							: `${tabLabel(tab)} (double-click to rename)`}
						onclick={() => onselect(tab.id)}
						ondblclick={() => (renaming = tab.id)}
					>
						{tabLabel(tab)}
					</button>
				{/if}
				<button
					class="mr-2 grid size-5 place-items-center rounded-sm text-muted-foreground outline-ring hover:bg-muted hover:text-foreground focus-visible:outline-2"
					aria-label="Close {tabLabel(tab)}"
					tabindex={selected ? 0 : -1}
					onclick={() => onclose(tab.id)}
				>
					<XIcon class="size-3.5" />
				</button>
			</div>
		{/each}
	</div>
	<Tooltip.Root>
		<Tooltip.Trigger
			class={[buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'mb-0.5']}
			aria-label="New tab"
			onclick={onnew}
		>
			<PlusIcon />
		</Tooltip.Trigger>
		<Tooltip.Content>New tab</Tooltip.Content>
	</Tooltip.Root>
</div>
