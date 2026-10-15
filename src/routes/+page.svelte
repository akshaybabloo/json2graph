<script lang="ts">
	import ChevronsDownUpIcon from '@lucide/svelte/icons/chevrons-down-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import FileBracesIcon from '@lucide/svelte/icons/file-braces';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import ListIndentIncreaseIcon from '@lucide/svelte/icons/list-indent-increase';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import SunIcon from '@lucide/svelte/icons/sun';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import { version } from '$app/env';
	import ExportMenu from '#lib/components/export-menu.svelte';
	import GithubIcon from '#lib/components/github-icon.svelte';
	import Logo from '#lib/components/logo.svelte';
	import WorkspaceTabs from '#lib/components/workspace-tabs.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Resizable from '#lib/components/ui/resizable/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { JsonEditor } from '#lib/editor/json-editor.js';
	import {
		ACCEPT,
		contentBlob,
		DEFAULT_TYPE,
		detect,
		documentType,
		DOCUMENT_TYPES,
		EXAMPLES,
		SNIFF_LENGTH,
		typeOfName,
		type DocumentType
	} from '#lib/document-types.js';
	import { GraphController, ZOOM_STEP } from '#lib/graph/controller.js';
	import type { EngineEvent, ExportOptions, GraphStats, LoadEvent } from '#lib/graph/protocol.js';
	import type { Session } from '#lib/session/protocol.js';
	import { TabSaver } from '#lib/session/saver.js';
	import { SessionStore } from '#lib/session/store.js';
	import { SITE } from '#lib/site.js';
	import { toggleTheme } from '#lib/theme.js';
	import { DROP_TEXT_OVER, newTab, tabLabel, toDiscard, type Tab } from '#lib/workspace.js';
	import { EditorState } from '@codemirror/state';
	import type { Pane } from 'paneforge';

	/**
	 * Larger files are shown as a graph only. The editor draws just the lines on
	 * screen, so scrolling is not what limits it: holding the text is, and
	 * handing all of it to the graph again after every edit.
	 */
	const EDITOR_LIMIT = 100 * 1024 * 1024;
	const REPOSITORY = 'https://github.com/akshaybabloo/json2graph';
	/**
	 * Where the release this was built from is described. Only a build made
	 * from a release's tag has the tag alone as its version, and so has one.
	 */
	const release = /^\d+\.\d+\.\d+$/.test(version)
		? `${REPOSITORY}/releases/tag/${version}`
		: undefined;
	const LABELS = { reading: 'Reading', parsing: 'Indexing', layout: 'Laying out' };
	/** The choice of a document's type that leaves it to be detected. */
	const AUTO = 'auto';
	/** What an image of a document that was typed rather than opened is called. */
	const UNTITLED = 'untitled';

	let controller: GraphController | undefined;
	let editor: JsonEditor | undefined;
	let sourcePane: Pane | undefined;
	/** Keeps the tabs over a reload; none in a window that leaves that to another. */
	let saver: TabSaver | null = null;
	/** Settles once the saved tabs are back, which comes before opening anything. */
	let sessionRestored: Promise<void> = Promise.resolve();
	/** Counts reads of files, so that each tab knows which one it waits for. */
	let opened = 0;
	let tabCount = 1;
	/** Counts the times a tab was shown, so that a read can tell it was hidden meanwhile. */
	let shown = 0;

	let tabs = $state<Tab[]>([newTab(1)]);
	let activeId = $state(1);
	/** The tab on screen. */
	const tab = $derived(tabs.find((t) => t.id === activeId)!);
	/** Name of the open file; none for a document that was typed. */
	const name = $derived(tab.name);
	/** Size of the open file when it is too large for the editor. */
	const tooLarge = $derived(tab.file?.size ?? null);
	/** The type of the document on screen. */
	const docType = $derived(documentType(tab.type));
	/** The saved text of the tab on screen while it is read back, before it is in the editor. */
	let readingText = $state<Blob | null>(null);
	/** Whether the saved tabs are being brought back, which the page waits for. */
	let restoring = $state(false);
	/** Whether this window keeps its tabs over a reload: a second window leaves that to the first. */
	let keepsTabs = $state(true);
	/** Why something could not be saved, when it could not. */
	let saveError = $state<string | null>(null);
	/** Whether the editor has no text. */
	let empty = $state(true);
	/** Whether the tab on screen has nothing in it, so that a document can be opened there. */
	const blank = $derived(name === null && tooLarge === null && empty && !readingText && !tab.lost);
	/** An example waiting to be told where to open, as the tab on screen is in use. */
	let pendingExample = $state<File | null>(null);
	/** Whether the editor's pane is collapsed, so only the graph shows. */
	let sourceHidden = $state(false);
	/** Whether the engine that draws the graph has loaded, and why not if it failed to. */
	let engineReady = $state(false);
	let engineError = $state<string | null>(null);
	let stats = $state<GraphStats | null>(null);
	/** Whether every node was last collapsed, rather than shown. A new graph shows them all. */
	let allCollapsed = $state(false);
	let progress = $state<{ label: string; fraction: number } | null>(null);
	let error = $state<string | null>(null);
	let dragging = $state(false);

	const number = new Intl.NumberFormat();

	function count(n: number, noun: string): string {
		return `${number.format(n)} ${noun}${n === 1 ? '' : 's'}`;
	}

	/** Size, node and value counts and load time of the graph on screen. */
	const summary = $derived(
		stats &&
			[
				bytes(stats.bytes),
				count(stats.boxes, 'node'),
				count(stats.values, 'value'),
				duration(stats.ms)
			].join(' · ')
	);

	/** What the header says about the graph: the step under way, or the summary. */
	const status = $derived(progress ? `${progress.label}…` : summary);

	/** What the graph is, for those who cannot see the canvas. */
	const graphLabel = $derived(
		stats
			? `Graph${name ? ` of ${name}` : ''}: ${count(stats.boxes, 'node')}, ${count(stats.values, 'value')}`
			: 'Graph: no document'
	);

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return `${(n / 1024 ** 3).toFixed(2)} GB`;
	}

	function duration(ms: number): string {
		return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
	}

	function graph(canvas: HTMLCanvasElement) {
		controller = new GraphController(canvas, onEvent);
		return () => {
			controller?.destroy();
			controller = undefined;
		};
	}

	function source(parent: HTMLElement) {
		editor = new JsonEditor(parent, {
			onEdit,
			onFormat: format,
			onEmpty: (value) => (empty = value)
		});
		editor.setLanguage(docType.language());
		return () => {
			editor?.destroy();
			editor = undefined;
		};
	}

	function onEvent(event: LoadEvent | EngineEvent) {
		if (event.type === 'engine') {
			engineReady = event.error === null;
			engineError = event.error;
			return;
		}
		if (event.type === 'progress') {
			progress = { label: LABELS[event.phase], fraction: event.fraction };
			return;
		}
		progress = null;
		if (event.type === 'ready') {
			stats = event.stats;
			// A graph that was kept is as it was left.
			if (!event.restored) {
				allCollapsed = false;
				error = null;
			}
			tab.indexed = true;
			tab.bytes = event.stats.bytes;
		} else {
			// The last graph stays, kept for the tab, while the text is invalid.
			tab.indexed = stats !== null;
			error = event.message;
			// The error is shown under the editor.
			sourcePane?.expand();
		}
	}

	/** An edit redraws the graph in place; while the text is invalid the last graph stays. */
	function onEdit(text: string) {
		if (!tab.typeChosen) setType(detect(tab.name, text), false);
		const content = contentBlob(text, docType);
		saver?.content(tab.id, content);
		if (text.trim() === '') {
			clearGraph();
			return;
		}
		// Until it is indexed, what the engine keeps is an older version.
		tab.indexed = false;
		controller?.load(tab.id, content, { keepView: true });
	}

	/** Re-indents the document in the editor, if its type has a formatter. Text that is not valid is left as it is. */
	async function format() {
		const formatter = docType.format;
		const text = editor?.text ?? '';
		if (!formatter || text.trim() === '') return;
		try {
			const formatted = await formatter(text);
			// Not over what was typed in the meantime.
			if (editor?.text === text) editor.replace(formatted);
		} catch (reason) {
			// The error of the graph, if it is on screen, says where the mistake is.
			error ??= `Cannot format: ${reason instanceof Error ? reason.message : reason}`;
		}
	}

	/**
	 * Makes the tab on screen a document of `type`, and says whether that is a
	 * change. A type that was chosen is no longer detected.
	 */
	function setType(type: DocumentType, chosen: boolean) {
		tab.typeChosen = chosen;
		if (tab.type === type.id) return false;
		tab.type = type.id;
		editor?.setLanguage(type.language());
		return true;
	}

	/** Detects the type of the document on screen again, or takes the one chosen. */
	function chooseType(choice: string) {
		const type =
			choice === AUTO
				? detect(tab.name, tab.file || readingText ? '' : (editor?.head(SNIFF_LENGTH) ?? ''))
				: documentType(choice);
		// Saved again, as content of its new type.
		if (setType(type, choice !== AUTO) && !readingText) {
			saver?.content(tab.id, contentBlob(tab.file ?? editor?.text ?? '', type), true);
		}
	}

	/** Removes the graph: an empty document has none, and is not an error. */
	function clearGraph() {
		stats = null;
		error = null;
		progress = null;
		tab.indexed = false;
		controller?.clear(tab.id);
	}

	/** Empties the editor and the graph of the tab on screen, ready for a new document. */
	function clear() {
		// Abandon a file that is still being read.
		tab.reading = ++opened;
		tab.name = null;
		tab.file = null;
		tab.lost = false;
		readingText = null;
		editor?.setText('');
		setType(DEFAULT_TYPE, false);
		saver?.content(tab.id, contentBlob('', DEFAULT_TYPE), true);
		clearGraph();
		// The button is now disabled, and would drop the focus it has.
		if (!sourceHidden) editor?.focus();
	}

	/** Keeps what the tab on screen needs to be shown again later. */
	function stash() {
		if (!editor) return;
		if (editor.pending) {
			// An edit that typing had not yet paused for: saved, but not indexed.
			saver?.content(tab.id, contentBlob(editor.text, docType));
			tab.indexed = false;
		}
		// A graph that is behind the text is not worth keeping.
		if (!tab.indexed) controller?.discard(tab.id);
		// Text still being read back stays where it is.
		tab.saved = readingText ?? editor.state;
		readingText = null;
		tab.view = controller?.view ?? tab.view;
		tab.allCollapsed = allCollapsed;
		tab.error = error;
		tab.hiddenAt = Date.now();
	}

	/**
	 * Puts the tab on screen into the editor, and its graph on the canvas: the
	 * one the engine kept, or, when that was discarded, its document indexed
	 * again. Text left in the browser's storage is read back first.
	 */
	function show() {
		const showing = ++shown;
		const current = tab;
		current.discarded = false;
		stats = null;
		progress = null;
		error = current.error;
		allCollapsed = current.allCollapsed;
		controller?.show(current.id, current.view);
		const saved = current.saved;
		current.saved = null;
		const language = documentType(current.type).language();
		if (saved instanceof Blob) {
			readingText = saved;
			editor?.restore('', language);
			empty = true;
			saved.text().then(
				(text) => {
					if (shown !== showing || readingText !== saved) return;
					readingText = null;
					editor?.restore(text, language);
					empty = editor?.empty ?? true;
					reindex();
				},
				() => {
					if (shown !== showing) return;
					readingText = null;
					current.lost = true;
				}
			);
		} else {
			editor?.restore(saved ?? '', language);
			empty = editor?.empty ?? true;
			reindex();
		}
		discardIdle();
	}

	/** Indexes the document of the tab on screen again, unless the engine kept it. */
	function reindex() {
		if (tab.indexed || tab.lost) return;
		if (tab.file) {
			controller?.load(tab.id, tab.file, { view: tab.view });
			return;
		}
		const text = editor?.text ?? '';
		if (text.trim()) controller?.load(tab.id, contentBlob(text, docType), { view: tab.view });
	}

	/**
	 * Frees the indexed documents of tabs left unused for a while, or beyond
	 * what is kept, and leaves their text in the browser's storage when it is large.
	 */
	function discardIdle() {
		for (const hidden of toDiscard(tabs, activeId, Date.now())) {
			hidden.indexed = false;
			hidden.discarded = true;
			controller?.discard(hidden.id);
			dropText(hidden);
		}
	}

	/** Lets go of the text of a hidden tab, once it is saved, in favour of the saved copy. */
	function dropText(hidden: Tab) {
		const state = hidden.saved;
		if (!saver || !(state instanceof EditorState) || state.doc.length <= DROP_TEXT_OVER) return;
		if (!saver.isSaved(hidden.id)) return;
		saver.read(hidden.id).then((content) => {
			// Unless it was shown or changed meanwhile.
			if (content && hidden.saved === state) hidden.saved = content;
		});
	}

	$effect(() => {
		const timer = setInterval(discardIdle, 60 * 1000);
		return () => clearInterval(timer);
	});

	/** The tabs as they are saved: their content is saved apart from this. */
	function sessionNow(): Session {
		return {
			active: activeId,
			tabs: tabs.map((t) => {
				const view = t.id === activeId ? (controller?.view ?? t.view) : t.view;
				return {
					id: t.id,
					name: t.name,
					file: t.file !== null,
					type: t.type,
					typeChosen: t.typeChosen,
					size: saver?.sizeOf(t.id) ?? 0,
					view: view && { x: view.x, y: view.y, k: view.k }
				};
			})
		};
	}

	/** Whenever a tab is opened, closed, renamed or shown, the list of tabs is saved. */
	const sessionShape = $derived(
		JSON.stringify([
			activeId,
			tabs.map((t) => [t.id, t.name, t.file !== null, t.lost, t.type, t.typeChosen])
		])
	);
	$effect(() => {
		if (sessionShape) saver?.session();
	});

	$effect(() => {
		let closed = false;
		restoring = true;
		sessionRestored = SessionStore.open().then(async (store) => {
			if (closed) return store?.destroy();
			if (!store) {
				keepsTabs = false;
				return;
			}
			saver = new TabSaver(store, sessionNow, (message) => (saveError = message));
			const { session, contents } = await store.call({ method: 'load' });
			if (closed) return;
			if (session) restore(session, new Map(contents));
			// Content that no tab holds any more.
			for (const [id] of contents) if (!tabs.some((t) => t.id === id)) saver.remove(id);
			saver.session();
		});
		sessionRestored.finally(() => (restoring = false)).catch(() => {});
		return () => {
			closed = true;
			saver?.destroy();
			saver = null;
		};
	});

	/**
	 * Brings back the saved tabs, each with its content left in the browser's
	 * storage until it is shown. The empty tab the page starts with makes way
	 * for them; anything opened before they were back stays, after them.
	 */
	function restore(session: Session, contents: Map<number, Blob>) {
		const pristine =
			tabs.length === 1 && name === null && tooLarge === null && empty && !readingText;
		let next = Math.max(tabCount, ...session.tabs.map((record) => record.id));
		const taken = new Set(pristine ? [] : tabs.map((t) => t.id));
		const restored = session.tabs.map((record) => {
			// A tab saved with nothing has no content, whatever is left under its id.
			const content = record.size > 0 ? (contents.get(record.id) ?? null) : null;
			let id = record.id;
			if (taken.has(id)) {
				id = ++next;
				if (content) saver?.content(id, content, true);
			}
			saver?.restored(id, record.size);
			return {
				...newTab(id),
				name: record.name,
				// Saved before there were types, or of a type there is no longer.
				type: documentType(record.type ?? DEFAULT_TYPE.id).id,
				typeChosen: record.typeChosen ?? false,
				view: record.view,
				file: record.file ? content : null,
				saved: record.file ? null : content,
				lost: content === null && record.size > 0
			};
		});
		tabCount = next;
		if (restored.length === 0) return;
		if (!pristine) {
			tabs.unshift(...restored);
			return;
		}
		tabs = restored;
		activeId = restored.some((t) => t.id === session.active) ? session.active : restored[0].id;
		show();
	}

	/** Saves what is waiting to be saved: the page is being hidden, and may be closed. */
	function flush() {
		// Reported now, the edit is saved now too.
		if (!readingText) editor?.flush();
		saver?.flush();
	}

	/**
	 * Asks before the page is left while an edit is not yet saved, and starts
	 * saving it, so that it is saved by the time the question is answered.
	 */
	function onBeforeUnload(event: BeforeUnloadEvent) {
		if (!saver || (!editor?.pending && !saver.busy)) return;
		flush();
		event.preventDefault();
	}

	function selectTab(id: number) {
		if (id === activeId) return;
		stash();
		activeId = id;
		show();
	}

	/** Opens an empty tab, and shows it. */
	function addTab(): Tab {
		stash();
		tabs.push(newTab(++tabCount));
		activeId = tabCount;
		show();
		return tab;
	}

	/** Closes a tab, and shows the one next to it. The last tab is emptied instead. */
	function closeTab(id: number) {
		if (tabs.length === 1) {
			clear();
			return;
		}
		const index = tabs.findIndex((t) => t.id === id);
		tabs.splice(index, 1);
		controller?.discard(id);
		saver?.remove(id);
		if (id !== activeId) return;
		readingText = null;
		activeId = tabs[Math.min(index, tabs.length - 1)].id;
		show();
	}

	/** Closes every tab but the one with this id, and shows it. */
	function closeOthers(keep: number) {
		for (const other of tabs) {
			if (other.id === keep) continue;
			controller?.discard(other.id);
			saver?.remove(other.id);
		}
		tabs = tabs.filter((t) => t.id === keep);
		if (keep === activeId) return;
		readingText = null;
		activeId = keep;
		show();
	}

	/** Closes every tab, which leaves one empty tab in their place. */
	function closeAll() {
		for (const closed of tabs) {
			controller?.discard(closed.id);
			saver?.remove(closed.id);
		}
		readingText = null;
		tabs = [newTab(++tabCount)];
		activeId = tabCount;
		show();
	}

	/**
	 * Opens a file into the tab on screen when that has nothing in it, and
	 * otherwise into a new tab; or, as asked, into one or the other.
	 */
	async function open(file: File, into: 'blank' | 'current' | 'new' = 'blank') {
		await sessionRestored;
		const here = into === 'current' || (into === 'blank' && blank);
		const target = here ? tab : addTab();
		if (here) {
			// What the tab held before goes.
			readingText = null;
			target.file = null;
			target.lost = false;
		}
		const id = (target.reading = ++opened);
		const since = shown;
		target.name = file.name;
		error = null;
		// What the name of the file says it is, or else what it starts with.
		const type = typeOfName(file.name) ?? detect(null, await file.slice(0, SNIFF_LENGTH).text());
		if (target.reading !== id || !tabs.includes(target)) return;
		target.type = type.id;
		target.typeChosen = false;
		if (target.id === activeId) editor?.setLanguage(type.language());
		// The file itself is kept: storing it does not read it on this thread.
		saver?.content(target.id, contentBlob(file, type), true);
		controller?.load(target.id, file);
		if (file.size > EDITOR_LIMIT) {
			target.file = file;
			stats = null;
			editor?.setText('');
			return;
		}
		const text = await file.text();
		if (target.reading !== id || !tabs.includes(target)) return;
		if (target.id !== activeId) {
			target.saved = text;
			return;
		}
		editor?.setText(text);
		// Shown again before its text was read, the tab has no graph yet.
		if (shown !== since) {
			controller?.load(target.id, contentBlob(text, type), { view: target.view });
		}
	}

	/** Opens the example of a type, asking first where to when the tab on screen is in use. */
	function openExample(type: DocumentType) {
		if (!type.example) return;
		const file = new File([type.example.text], type.example.name, { type: type.mime });
		if (blank) open(file);
		else pendingExample = file;
	}

	/** Opens the example that was waiting, where the user said. */
	function placeExample(into: 'current' | 'new') {
		const file = pendingExample;
		pendingExample = null;
		if (file) open(file, into);
	}

	function onPick(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (file) open(file);
		// Allow picking the same file again.
		input.value = '';
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function onDragOver(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragging = true;
	}

	function onDrop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragging = false;
		const file = event.dataTransfer?.files[0];
		if (file) open(file);
	}

	/** Saves the graph as a PNG named after the document. */
	async function exportImage(options: ExportOptions) {
		const blob = await controller?.exportImage(options);
		if (!blob) return;
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `${name?.replace(/\.json$/i, '') ?? UNTITLED}.png`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	const tools = [
		{ label: 'Zoom in', icon: ZoomInIcon, run: () => controller?.zoomBy(ZOOM_STEP) },
		{ label: 'Zoom out', icon: ZoomOutIcon, run: () => controller?.zoomBy(1 / ZOOM_STEP) },
		{ label: 'Fit to view', icon: MaximizeIcon, run: () => controller?.fit() }
	];

	function toggleAll() {
		allCollapsed = !allCollapsed;
		controller?.collapseAll(allCollapsed);
	}
</script>

<svelte:head>
	<title>{SITE.title}</title>
</svelte:head>

<svelte:window
	ondragover={onDragOver}
	ondragleave={(event) => {
		// Only when the pointer leaves the window, not when it crosses elements.
		if (!event.relatedTarget) dragging = false;
	}}
	ondrop={onDrop}
	onbeforeunload={onBeforeUnload}
	onpagehide={flush}
/>

<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === 'hidden') flush();
	}}
/>

<div class="flex h-dvh flex-col">
	<a
		href="#graph"
		class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
	>
		Skip to the graph
	</a>
	<header class="flex items-center gap-2 border-b px-4 py-2 text-sm">
		<h1 class="flex items-center gap-1.5 font-semibold">
			<Logo class="size-6" />
			<span>json<span class="text-(--brand)">2</span>graph</span>
		</h1>
		<Badge
			variant="secondary"
			class="mr-2"
			href={release}
			target={release && '_blank'}
			rel={release && 'noreferrer'}
			aria-label={release && `Version ${version} on GitHub`}
			title={release ? `Version ${version} on GitHub` : `Version ${version}`}
		>
			{version}
		</Badge>
		<label
			class={[
				buttonVariants({ variant: 'outline', size: 'sm' }),
				'cursor-pointer focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50'
			]}
		>
			<FolderOpenIcon />
			Open file
			<input type="file" accept={ACCEPT} class="sr-only" onchange={onPick} />
		</label>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class={buttonVariants({ variant: 'outline', size: 'sm' })}>
				<FileBracesIcon />
				Example
				<ChevronDownIcon />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-auto min-w-44">
				<DropdownMenu.Label>Open an example</DropdownMenu.Label>
				{#each EXAMPLES as type (type.id)}
					<DropdownMenu.Item onSelect={() => openExample(type)}>{type.label}</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<p class="ml-auto truncate text-muted-foreground" aria-live="polite">{status}</p>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Switch between light and dark mode"
			title="Switch between light and dark mode"
			onclick={toggleTheme}
		>
			<SunIcon class="dark:hidden" />
			<MoonIcon class="hidden dark:block" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			href={REPOSITORY}
			target="_blank"
			rel="noreferrer"
			aria-label="json2graph on GitHub"
			title="json2graph on GitHub"
		>
			<GithubIcon />
		</Button>
	</header>

	<!-- The tabs and what they show, which wait for the saved tabs to be restored. -->
	<div class="relative flex min-h-0 flex-1 flex-col" aria-busy={restoring}>
		{#if restoring}
			<!-- Faded in, so that it does not flash when there is little or nothing to restore. -->
			<div
				class="absolute inset-0 z-20 grid animate-in place-items-center bg-background text-sm duration-500 fade-in-0"
			>
				<p class="flex items-center gap-2 text-muted-foreground">
					<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
					Restoring your tabs…
				</p>
			</div>
		{/if}

		<WorkspaceTabs
			{tabs}
			active={activeId}
			controls="workspace"
			onselect={selectTab}
			onclose={closeTab}
			oncloseothers={closeOthers}
			oncloseall={closeAll}
			onrename={(id, value) => {
				const renamed = tabs.find((t) => t.id === id);
				if (renamed) renamed.name = value;
			}}
			onnew={() => {
				addTab();
				if (!sourceHidden) editor?.focus();
			}}
		/>

		<main class="flex min-h-0 flex-1">
			<Resizable.PaneGroup
				id="workspace"
				direction="horizontal"
				class="min-h-0 flex-1"
				role="tabpanel"
				aria-labelledby="tab-{activeId}"
			>
				<Resizable.Pane
					bind:this={sourcePane}
					defaultSize={28}
					minSize={12}
					maxSize={70}
					collapsible
					collapsedSize={0}
					onCollapse={() => (sourceHidden = true)}
					onExpand={() => (sourceHidden = false)}
				>
					<section id="source" class="relative flex h-full flex-col" aria-label="JSON source">
						<div class="min-h-0 flex-1" {@attach source}></div>

						{#if error}
							<p class="border-t px-3 py-1.5 text-xs text-destructive" role="alert">{error}</p>
						{/if}

						{#if readingText}
							<div
								class="absolute inset-0 grid place-items-center bg-background p-6 text-center text-sm"
								aria-busy="true"
							>
								<p class="flex items-center gap-2 text-muted-foreground">
									<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
									Reading {tabLabel(tab)}…
								</p>
							</div>
						{:else if tab.lost}
							<div
								class="absolute inset-0 grid place-items-center bg-background p-6 text-center text-sm"
							>
								<p class="max-w-xs text-muted-foreground">
									<span class="font-medium text-foreground">{tabLabel(tab)}</span> was not kept when the
									page closed, so it cannot be shown. Open it again to see it.
								</p>
							</div>
						{:else if tooLarge !== null}
							<div
								class="absolute inset-0 grid place-items-center bg-background p-6 text-center text-sm"
							>
								<p class="max-w-xs text-muted-foreground">
									<span class="font-medium text-foreground">{name}</span> is {bytes(tooLarge)},
									which is too large to edit as text. The graph shows the whole file.
								</p>
							</div>
						{/if}
					</section>
				</Resizable.Pane>

				<Resizable.Handle withHandle aria-label="Resize the editor and the graph" />

				<!-- Sized like the other pane: before the page's script runs, a pane has only this to go by. -->
				<Resizable.Pane defaultSize={72}>
					<section class="relative h-full" aria-label="Graph">
						<!--
						The canvas takes the keys that move the view (see GraphController),
						which no standard widget does: that is what the application role is for.
					-->
						<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
						<canvas
							{@attach graph}
							id="graph"
							class="absolute inset-0 h-full w-full touch-none outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
							role="application"
							tabindex="0"
							aria-label={graphLabel}
							aria-describedby="graph-help"
						></canvas>

						<div
							class="absolute top-3 right-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-xs"
							role="toolbar"
							aria-label="Graph view"
							aria-orientation="vertical"
						>
							{#each tools as tool (tool.label)}
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={!stats}
									aria-label={tool.label}
									title={tool.label}
									onclick={tool.run}
								>
									<tool.icon />
								</Button>
							{/each}
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={!stats}
								aria-label={allCollapsed ? 'Expand all nodes' : 'Collapse all nodes'}
								title={allCollapsed ? 'Expand all nodes' : 'Collapse all nodes'}
								onclick={toggleAll}
							>
								{#if allCollapsed}
									<ChevronsUpDownIcon />
								{:else}
									<ChevronsDownUpIcon />
								{/if}
							</Button>
							<ExportMenu disabled={!stats} onexport={exportImage} />
						</div>

						{#if progress}
							<div
								class="absolute inset-x-0 top-0 h-1 bg-muted"
								role="progressbar"
								aria-label={progress.label}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(progress.fraction * 100)}
							>
								<div class="h-full bg-primary" style:width="{progress.fraction * 100}%"></div>
							</div>
						{/if}

						{#if engineError !== null}
							<div class="absolute inset-0 grid place-items-center p-6 text-center text-sm">
								<p class="max-w-sm text-destructive" role="alert">
									The graph engine could not be loaded, so no graph can be drawn: {engineError}.
									Reload the page to try again.
								</p>
							</div>
						{:else if !engineReady}
							<p
								class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
								role="status"
							>
								<LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
								Loading the graph engine…
							</p>
						{:else if !stats && !progress && !error && tooLarge === null && !readingText && !tab.lost}
							<div
								class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm"
							>
								<p class="max-w-xs text-muted-foreground">
									{#if sourceHidden}
										Open a file, or drop one anywhere on the page.
									{:else}
										Type or paste JSON on the left, open a file, or drop one anywhere on the page.
									{/if}
									<span class="font-medium text-foreground">Example</span> loads a sample document.
								</p>
							</div>
						{/if}

						<p
							id="graph-help"
							class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground"
						>
							Drag to pan · scroll to zoom · click + or − on the edge of a node to show or hide the
							next one · click a shortened value to expand it
							<span class="sr-only">
								With the keyboard: the arrow keys pan, plus and minus zoom, and zero fits the graph.
							</span>
						</p>
					</section>
				</Resizable.Pane>
			</Resizable.PaneGroup>
		</main>
	</div>

	<footer class="flex items-center gap-2 border-t px-2 py-1 text-xs">
		<Tooltip.Root>
			<Tooltip.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
				aria-label={sourceHidden ? 'Show editor' : 'Hide editor'}
				aria-controls="source"
				aria-expanded={!sourceHidden}
				onclick={() => (sourceHidden ? sourcePane?.expand() : sourcePane?.collapse())}
			>
				{#if sourceHidden}
					<PanelLeftOpenIcon />
				{:else}
					<PanelLeftCloseIcon />
				{/if}
			</Tooltip.Trigger>
			<Tooltip.Content>{sourceHidden ? 'Show editor' : 'Hide editor'}</Tooltip.Content>
		</Tooltip.Root>
		<DropdownMenu.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<DropdownMenu.Trigger
							{...props}
							class={buttonVariants({ variant: 'ghost', size: 'xs' })}
							aria-label="Type of the document: {docType.label}"
						>
							{docType.label}
							<ChevronsUpDownIcon />
						</DropdownMenu.Trigger>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>
					{tab.typeChosen ? 'Type of the document' : 'Type of the document, as detected'}
				</Tooltip.Content>
			</Tooltip.Root>
			<DropdownMenu.Content align="start" side="top" class="w-auto min-w-44">
				<DropdownMenu.RadioGroup
					value={tab.typeChosen ? tab.type : AUTO}
					onValueChange={chooseType}
				>
					<DropdownMenu.RadioItem value={AUTO} closeOnSelect
						>Detect automatically</DropdownMenu.RadioItem
					>
					<DropdownMenu.Separator />
					{#each DOCUMENT_TYPES as type (type.id)}
						<DropdownMenu.RadioItem value={type.id} closeOnSelect
							>{type.label}</DropdownMenu.RadioItem
						>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Tooltip.Root>
			<Tooltip.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'xs' })}
				disabled={empty || !docType.format || readingText !== null}
				onclick={format}
			>
				<ListIndentIncreaseIcon />
				Format
			</Tooltip.Trigger>
			<Tooltip.Content>Format the {docType.label} (Shift+Alt+F in the editor)</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger
				class={buttonVariants({ variant: 'ghost', size: 'xs' })}
				disabled={empty && name === null}
				onclick={clear}
			>
				<EraserIcon />
				Clear
			</Tooltip.Trigger>
			<Tooltip.Content>Empty this tab: its text and its graph</Tooltip.Content>
		</Tooltip.Root>
		<p class="ml-auto truncate text-muted-foreground" aria-live="polite">
			{#if saveError}
				<span class="text-destructive">Some tabs could not be kept: {saveError}</span>
			{:else if keepsTabs}
				Tabs are kept in this browser until you close them
			{:else}
				Tabs in this window are not kept, because another window keeps its own
			{/if}
		</p>
	</footer>

	<AlertDialog.Root
		open={pendingExample !== null}
		onOpenChange={(open) => {
			if (!open) pendingExample = null;
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Where should the example open?</AlertDialog.Title>
				<AlertDialog.Description>
					{tabLabel(tab)} already has a document in it. The example can replace it, or open in a new tab.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action variant="outline" onclick={() => placeExample('current')}>
					Replace this tab
				</AlertDialog.Action>
				<AlertDialog.Action onclick={() => placeExample('new')}
					>Open in a new tab</AlertDialog.Action
				>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	{#if dragging}
		<div
			class="pointer-events-none fixed inset-2 grid place-items-center rounded-lg border-2 border-dashed border-ring bg-muted/70 text-sm font-medium"
		>
			Drop a file to open it
		</div>
	{/if}
</div>
