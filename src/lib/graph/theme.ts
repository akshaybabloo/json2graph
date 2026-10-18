/** Colours of the graph canvas. */
export interface Theme {
	background: string;
	/** Lines of the grid behind the graph. */
	grid: string;
	box: string;
	border: string;
	edge: string;
	key: string;
	string: string;
	number: string;
	boolean: string;
	null: string;
	/** The `{3}` / `[5]` summary of a nested object or array. */
	container: string;
	/** The mark on the row that the cursor of the code is in, or that was clicked. */
	link: string;
	/** The mark on the rows a search found. */
	found: string;
}

/**
 * Reads the theme from the design tokens in effect at `element` (see
 * `src/routes/layout.css`), so the canvas follows the rest of the page,
 * including the `.dark` class.
 */
export function readTheme(element: Element): Theme {
	const style = getComputedStyle(element);
	const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	return {
		background: token('--background', '#ffffff'),
		grid: token('--graph-grid', '#cdd5e1'),
		box: token('--graph-box', '#ffffff'),
		border: token('--graph-border', '#e5e5e5'),
		edge: token('--muted-foreground', '#737373'),
		key: token('--foreground', '#0a0a0a'),
		null: token('--muted-foreground', '#737373'),
		string: token('--json-string', '#15803d'),
		number: token('--json-number', '#b45309'),
		boolean: token('--json-boolean', '#7c3aed'),
		container: token('--json-container', '#0369a1'),
		link: token('--brand', '#2457d6'),
		found: token('--graph-found', '#eab308')
	};
}
