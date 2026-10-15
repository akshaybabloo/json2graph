/**
 * Draws Mermaid diagrams as SVG. Mermaid is large, so it is fetched only when
 * the first diagram is drawn.
 */
import type { Mermaid } from 'mermaid';

/**
 * The most text, and the most edges, that a diagram may have. Mermaid's own
 * limits are for pages that show what others wrote; here it is the user's
 * own diagram, drawn on their own page.
 */
const MAX_TEXT = 1_000_000;
const MAX_EDGES = 20_000;

/** A diagram drawn as SVG, and what kind of diagram it is. */
export type Drawn = { svg: string; type: string };

let loaded: Promise<Mermaid> | undefined;
let drawn = 0;

function mermaid(): Promise<Mermaid> {
	loaded ??= import('mermaid').then(
		(module) => module.default,
		(error) => {
			// Fetched again the next time, rather than keep the failure.
			loaded = undefined;
			throw new Error('The diagram renderer could not be loaded', { cause: error });
		}
	);
	return loaded;
}

/**
 * Draws Mermaid `text` in the light or `dark` theme, over `background`.
 * Rejects with where the mistake is when the text is not a diagram Mermaid can
 * draw.
 */
export async function drawDiagram(text: string, dark: boolean, background: string): Promise<Drawn> {
	const api = await mermaid();
	api.initialize({
		startOnLoad: false,
		theme: dark ? 'dark' : 'default',
		// Flat, as the graph is: no gradients on the outlines of nodes, and no shadows.
		themeVariables: { useGradient: false, dropShadow: 'none' },
		// The labels of edges are see-through, so the line shows through them;
		// solid in the colour behind the diagram, they break the line instead.
		themeCSS: `.edgeLabel rect { opacity: 1; fill: ${background}; } .edgeLabel, .edgeLabel p, .labelBkg { background-color: ${background}; }`,
		securityLevel: 'strict',
		maxTextSize: MAX_TEXT,
		maxEdges: MAX_EDGES
	});
	const id = `diagram-${++drawn}`;
	try {
		const { svg, diagramType } = await api.render(id, text);
		// Without the version of Mermaid's renderer: `flowchart-v2` is a flowchart.
		return { svg, type: diagramType.replace(/-v\d+$/, '') };
	} catch (error) {
		throw new Error(describe(error), { cause: error });
	} finally {
		// What Mermaid draws into while it renders, which a failure can leave behind.
		document.getElementById(`d${id}`)?.remove();
	}
}

/**
 * Mermaid's message for a mistake on one line: where it is, and what was
 * expected there, without the excerpt of the text between them.
 */
function describe(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const lines = message
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length <= 1) return lines[0] ?? 'The diagram could not be drawn';
	return `${lines[0]} ${lines.at(-1)}`;
}
