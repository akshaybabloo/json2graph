/**
 * The line a Mermaid diagram starts with, which names its kind. Kinds that are
 * also everyday words stand alone on their line, as they do in a diagram, so
 * that a line of prose is not taken for one; a few take more after them.
 */
export const DIAGRAM_START = new RegExp(
	'^(?:' +
		[
			'(?:graph|flowchart(?:-elk)?)(?:\\s.*)?',
			'(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|requirementDiagram|quadrantChart|gitGraph|zenuml)(?:\\s.*)?',
			'C4(?:Context|Container|Component|Dynamic|Deployment)(?:\\s.*)?',
			'pie(?:\\s+(?:title|showData)\\b.*)?',
			'xychart(?:-beta)?(?:\\s+(?:horizontal|vertical))?',
			'(?:gantt|journey|timeline|mindmap|kanban|architecture(?:-beta)?|block(?:-beta)?|packet(?:-beta)?|sankey(?:-beta)?|radar-beta|treemap(?:-beta)?|venn-beta|ishikawa(?:-beta)?)'
		].join('|') +
		')\\s*$'
);

/**
 * Whether `text` starts like a Mermaid diagram: with the line that names its
 * kind, after any front matter, blank lines, comments and directives.
 */
export function looksLikeMermaid(text: string): boolean {
	const lines = text.split(/\r\n|\n|\r/);
	let i = 0;
	const skip = () => {
		while (i < lines.length && (lines[i].trim() === '' || lines[i].trimStart().startsWith('%%'))) {
			i++;
		}
	};
	skip();
	// Front matter: YAML between two lines of three dashes.
	if (lines[i]?.trim() === '---') {
		const end = lines.findIndex((line, at) => at > i && line.trim() === '---');
		if (end < 0) return false;
		i = end + 1;
		skip();
	}
	return i < lines.length && DIAGRAM_START.test(lines[i].trim());
}
