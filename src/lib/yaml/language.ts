import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * What a plain (unquoted) value is in YAML's core schema, which the graph
 * reads it with: null, a boolean, a number, or else a string.
 */
const PLAIN_KINDS: [RegExp, string][] = [
	[/^(?:~|null|Null|NULL)$/, 'null'],
	[/^(?:true|True|TRUE|false|False|FALSE)$/, 'boolean'],
	[
		/^(?:[-+]?(?:\.\d+|\d+(?:\.\d*)?)(?:[eE][-+]?\d+)?|0o[0-7]+|0x[\da-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
		'number'
	]
];

const marks = Object.fromEntries(
	PLAIN_KINDS.map(([, kind]) => [kind, Decoration.mark({ class: `cm-yaml-${kind}` })])
);

/** Marks the plain values on screen that are not strings with what they are. */
function plainValues(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				// Keys are names, whatever they look like.
				if (node.name === 'Key') return false;
				if (node.name !== 'Literal') return;
				const text = view.state.sliceDoc(node.from, node.to);
				const kind = PLAIN_KINDS.find(([pattern]) => pattern.test(text))?.[1];
				if (kind) builder.add(node.from, node.to, marks[kind]);
			}
		});
	}
	return builder.finish();
}

const plainValueKinds = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = plainValues(view);
		}

		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.viewportChanged ||
				syntaxTree(update.startState) !== syntaxTree(update.state)
			) {
				this.decorations = plainValues(update.view);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations }
);

// The colours the graph gives the same kinds of value. Plain values are
// strings unless they are marked as something else.
const colours = [
	syntaxHighlighting(
		HighlightStyle.define([
			{ tag: tags.content, color: 'var(--json-string)' },
			{ tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
			{ tag: [tags.meta, tags.keyword, tags.typeName], color: 'var(--muted-foreground)' },
			{ tag: tags.labelName, color: 'var(--json-container)' }
		])
	),
	// The mark is drawn around the highlighting of the value, which would colour it as a string.
	EditorView.baseTheme({
		'.cm-yaml-null, .cm-yaml-null *': { color: 'var(--muted-foreground)' },
		'.cm-yaml-boolean, .cm-yaml-boolean *': { color: 'var(--json-boolean)' },
		'.cm-yaml-number, .cm-yaml-number *': { color: 'var(--json-number)' }
	})
];

/** YAML in the editor: its grammar, and its values coloured as the graph colours them. */
export function yamlLanguage(): Extension {
	return [yaml(), colours, plainValueKinds];
}
