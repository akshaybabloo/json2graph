<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LinkIcon from '@lucide/svelte/icons/link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { SHARE_MAX, SHARE_TEXT_MAX, SHARE_WARN, shareHash, type Shared } from '#lib/share.js';

	/**
	 * Shares the document on screen as a link that carries it, which is made
	 * when the popover opens: nothing is uploaded.
	 */
	let {
		disabled = false,
		label,
		document: shared
	}: {
		disabled?: boolean;
		/** What the document is called on screen: "JSON". */
		label: string;
		/** The document on screen, as the link carries it. */
		document: () => Shared;
	} = $props();

	const id = $props.id();
	/**
	 * The link to the document; or, when that is too long to open, how long it
	 * would be, unknown for a document too large to be worth compressing.
	 */
	let link = $state<{ url: string } | { length: number | null } | null>(null);
	let copied = $state<boolean | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

	/** A length as a size, which does not break across lines. */
	function size(characters: number): string {
		return characters < 1024 * 1024
			? `${number.format(characters / 1024)}\u00a0KB`
			: `${number.format(characters / 1024 / 1024)}\u00a0MB`;
	}

	function make() {
		copied = null;
		link = null;
		const doc = shared();
		if (doc.text.length > SHARE_TEXT_MAX) {
			link = { length: null };
			return;
		}
		try {
			const url = `${location.origin}${location.pathname}${shareHash(doc)}`;
			link = url.length > SHARE_MAX ? { length: url.length } : { url };
		} catch {
			// Out of memory to compress it in, it is too large all the same.
			link = { length: null };
		}
	}

	async function copy() {
		if (!link || !('url' in link)) return;
		try {
			await navigator.clipboard.writeText(link.url);
			copied = true;
		} catch {
			copied = false;
			input?.select();
		}
	}
</script>

<Popover.Root
	onOpenChange={(opening) => {
		if (opening) make();
	}}
>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Popover.Trigger
					{...props}
					class={buttonVariants({ variant: 'ghost', size: 'xs' })}
					{disabled}
				>
					<LinkIcon />
					Share
				</Popover.Trigger>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>Share this {label} as a link</Tooltip.Content>
	</Tooltip.Root>
	<Popover.Content side="top" align="start" class="w-96 max-w-[calc(100vw-2rem)]">
		<Popover.Header>
			<Popover.Title>Share as a link</Popover.Title>
			<Popover.Description>
				The link holds the {label} itself, so nothing is uploaded. Opening it shows the {label} in a new
				tab.
			</Popover.Description>
		</Popover.Header>

		{#if link && 'url' in link}
			<div class="flex flex-col gap-1.5">
				<InputGroup.Root>
					<InputGroup.Input
						bind:ref={input}
						value={link.url}
						readonly
						aria-label="Link to the {label}"
						aria-describedby="{id}-size"
						class="font-mono text-xs"
						onfocus={(event) => event.currentTarget.select()}
					/>
					<InputGroup.Addon align="inline-end">
						<InputGroup.Button
							variant="default"
							size="xs"
							onclick={copy}
							aria-describedby="{id}-copied"
						>
							{#if copied}
								<CheckIcon />
								Copied
							{:else}
								<CopyIcon />
								Copy
							{/if}
						</InputGroup.Button>
					</InputGroup.Addon>
				</InputGroup.Root>
				<p id="{id}-size" class="text-xs text-muted-foreground">
					The link is {size(link.url.length)}.
					{#if link.url.length > SHARE_WARN}
						<span class="mt-1 flex gap-1.5 text-amber-700 dark:text-amber-400">
							<TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
							A link this long may be cut short when it is pasted into chat or email.
						</span>
					{/if}
				</p>
				<!-- Kept while empty, as it is read out once it changes; out of the way until then. -->
				<p
					id="{id}-copied"
					class={['text-xs text-destructive', copied !== false && 'sr-only']}
					aria-live="polite"
				>
					{copied === false ? 'It could not be copied: select the link and copy it yourself.' : ''}
				</p>
			</div>
		{:else if link}
			{@const over = link.length === null ? '' : `, and this one would be ${size(link.length)}`}
			<p class="flex gap-1.5 text-xs text-destructive" role="alert">
				<TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
				Too large to share as a link: browsers open links of up to {size(SHARE_MAX)}{over}.
			</p>
		{/if}
	</Popover.Content>
</Popover.Root>
