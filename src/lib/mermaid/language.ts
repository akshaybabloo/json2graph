/**
 * Mermaid in the editor: the highlighting of the Mermaid Live Editor
 * (https://github.com/mermaid-js/mermaid-live-editor, `src/lib/util/monacoExtra.ts`,
 * itself after https://github.com/Yash-Singh1/monaco-mermaid), ported from
 * Monaco's Monarch to CodeMirror. Its rules are kept as they are, in a state
 * for each kind of diagram, which the line that names the kind enters.
 *
 * MIT License. Copyright (c) 2020 - 2023 Knut Sveidqvist. The full text is
 * in the Live Editor's repository.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { DIAGRAM_START } from './detect';

/** What a token is, by the names the Live Editor gives them; null for nothing in particular. */
type Style =
	| 'typeKeyword'
	| 'keyword'
	| 'string'
	| 'transition'
	| 'delimiter'
	| 'annotation'
	| 'number'
	| 'comment'
	| 'variable'
	| 'type'
	| 'meta'
	| null;

/** The style of a word, by the words it is one of. */
type Cases = (word: string) => Style;

/**
 * What a rule gives what it matches: a style, a style for each of its groups,
 * which cover all of it, or a style for the word it matched.
 */
type Action = Style | Style[] | Cases;

/**
 * A rule of a state: what it matches at the current position, what that is,
 * and the state to go to next, `@pop` to go back to the one before.
 */
type Rule = { pattern: RegExp; atLineStart: boolean; action: Action; next?: string };

function rule(pattern: RegExp | string, action: Action, next?: string): Rule {
	const source = typeof pattern === 'string' ? escape(pattern) : pattern.source;
	// As in Monarch, a rule that starts with `^` matches only at the start of a line.
	const atLineStart = source.startsWith('^');
	return {
		pattern: new RegExp(`^(?:${atLineStart ? source.slice(1) : source})`),
		atLineStart,
		action,
		next
	};
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words that are block keywords or keywords of a kind of diagram, and what other words are. */
function cases(blockKeywords: string[], keywords: string[], otherwise: Style = null): Cases {
	const blocks = new Set(blockKeywords);
	const words = new Set(keywords);
	return (word) => (blocks.has(word) ? 'typeKeyword' : words.has(word) ? 'keyword' : otherwise);
}

const comment = /(?<!["'])%%(?![^"']*["']\)).*$/;
/** `%%{init: …}%%`: the configuration of a diagram, up to the `%%` that ends its line. */
const configDirective = rule(/^\s*%%(?={)/, 'string', 'configDirective');

const requirementDiagrams = [
	'requirement',
	'functionalRequirement',
	'interfaceRequirement',
	'performanceRequirement',
	'physicalRequirement',
	'designConstraint'
];

const c4Words = cases(
	[
		'Boundary',
		'Enterprise_Boundary',
		'System_Boundary',
		'Container_Boundary',
		'Node',
		'Node_L',
		'Node_R'
	],
	[
		'title',
		'accDescription',
		'direction',
		'TB',
		'BT',
		'RL',
		'LR',
		'Person_Ext',
		'Person',
		'SystemQueue_Ext',
		'SystemDb_Ext',
		'System_Ext',
		'SystemQueue',
		'SystemDb',
		'System',
		'ContainerQueue_Ext',
		'ContainerDb_Ext',
		'Container_Ext',
		'ContainerQueue',
		'ContainerDb',
		'Container',
		'ComponentQueue_Ext',
		'ComponentDb_Ext',
		'Component_Ext',
		'ComponentQueue',
		'ComponentDb',
		'Component',
		'Deployment_Node',
		'Rel',
		'BiRel',
		'Rel_Up',
		'Rel_U',
		'Rel_Down',
		'Rel_D',
		'Rel_Left',
		'Rel_L',
		'Rel_Right',
		'Rel_R',
		'Rel_Back',
		'RelIndex'
	],
	'variable'
);
const classWords = cases(
	['class'],
	[
		'link',
		'click',
		'callback',
		'call',
		'href',
		'cssClass',
		'direction',
		'TB',
		'BT',
		'RL',
		'LR',
		'title',
		'accDescription',
		'order'
	],
	'variable'
);
const flowchartWords = cases(
	['subgraph', 'end'],
	[
		'TB',
		'TD',
		'BT',
		'RL',
		'LR',
		'click',
		'call',
		'href',
		'_self',
		'_blank',
		'_parent',
		'_top',
		'linkStyle',
		'style',
		'classDef',
		'class',
		'direction',
		'interpolate'
	],
	'variable'
);
const ganttWords = cases(
	[],
	['title', 'dateFormat', 'axisFormat', 'todayMarker', 'section', 'excludes', 'inclusiveEndDates']
);
const gitGraphWords = cases(
	[],
	[
		'accTitle',
		'accDescr',
		'commit',
		'cherry-pick',
		'branch',
		'merge',
		'reset',
		'checkout',
		'LR',
		'BT',
		'id',
		'msg',
		'type',
		'tag',
		'NORMAL',
		'REVERSE',
		'HIGHLIGHT'
	]
);
const journeyWords = cases(['section'], ['title'], 'variable');
const pieWords = cases([], ['showData', 'title', 'accDescr', 'accTitle']);
const requirementWords = cases([...requirementDiagrams, 'element'], [], 'variable');
const sequenceWords = cases(
	['alt', 'par', 'and', 'loop', 'else', 'end', 'rect', 'opt'],
	[
		'participant',
		'as',
		'Note',
		'note',
		'over',
		'activate',
		'deactivate',
		'autonumber',
		'title',
		'actor',
		'accDescription',
		'link',
		'links'
	],
	'variable'
);
const stateWords = cases(
	['state', 'note', 'end'],
	['state', 'as', 'direction', 'TB', 'BT', 'RL', 'LR'],
	'variable'
);

/** The states of the tokenizer, and their rules, tried in turn. */
const STATES: Record<string, Rule[]> = {
	root: [
		// Front matter: YAML between two lines of three dashes, before the diagram.
		rule(/^---\s*$/, 'meta', 'frontMatter'),
		rule(/^\s*gitGraph/, 'typeKeyword', 'gitGraph'),
		rule(/^\s*info/, 'typeKeyword', 'info'),
		rule(/^\s*pie/, 'typeKeyword', 'pie'),
		rule(/^\s*(flowchart|flowchart-v2|graph)/, 'typeKeyword', 'flowchart'),
		rule(/^\s*sequenceDiagram/, 'typeKeyword', 'sequenceDiagram'),
		rule(/^\s*classDiagram(-v2)?/, 'typeKeyword', 'classDiagram'),
		rule(/^\s*journey/, 'typeKeyword', 'journey'),
		rule(/^\s*gantt/, 'typeKeyword', 'gantt'),
		rule(/^\s*stateDiagram(-v2)?/, 'typeKeyword', 'stateDiagram'),
		rule(/^\s*er(Diagram)?/, 'typeKeyword', 'erDiagram'),
		rule(/^\s*requirement(Diagram)?/, 'typeKeyword', 'requirementDiagram'),
		rule(/^\s*sankey-beta/, 'typeKeyword', 'sankey'),
		rule(
			/^\s*(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/,
			'typeKeyword',
			'c4Diagram'
		),
		configDirective,
		rule(/%%[^${].*$/, 'comment')
	],
	frontMatter: [rule(/^---\s*$/, 'meta', '@pop'), rule(/.+/, 'meta')],
	configDirective: [rule(/%%$/, 'string', '@pop'), rule(/[^%]+|%/, 'string')],
	c4Diagram: [
		configDirective,
		rule(/(title|accDescription)(.*$)/, ['keyword', 'string']),
		rule(/\(/, 'delimiter', 'c4DiagramParenthesis'),
		rule(/[A-Z_a-z-][\w$]*/, c4Words),
		rule(comment, 'comment')
	],
	c4DiagramParenthesis: [
		rule(/,/, 'delimiter'),
		rule(/\)/, 'delimiter', '@pop'),
		rule(/[^),]/, 'string')
	],
	classDiagram: [
		configDirective,
		rule(/(^\s*(?:title|accDescription))(\s+.*$)/, ['keyword', 'string']),
		rule(/(\*|<\|?|o|)(--|\.\.)(\*|\|?>|o|)([\t ]*[A-Za-z]+[\t ]*)(:)(.*?$)/, [
			'transition',
			'transition',
			'transition',
			'variable',
			'delimiter',
			'string'
		]),
		rule(/(?!class\s)([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']),
		rule(/(\*|<\|?|o)?(--|\.\.)(\*|\|?>|o)?/, 'transition'),
		rule(/^\s*class\s(?!.*{)/, 'keyword'),
		rule(/[A-Za-z][\w$]*/, classWords),
		rule(comment, 'comment'),
		rule(/(<<)(.+?)(>>)/, ['delimiter', 'annotation', 'delimiter']),
		rule(/".*?"/, 'string'),
		rule(/:::/, 'transition'),
		rule(/:|\+|-|#|~|\*\s*$|\$\s*$|\(|\)|{|}/, 'delimiter')
	],
	erDiagram: [
		configDirective,
		rule(/(title|accDescription)(.*$)/, ['keyword', 'string']),
		rule(/[|}][o|](--|\.\.)[o|][{|]/, 'transition'),
		rule(/".*?"/, 'string'),
		rule(/(:)(.*?$)/, ['delimiter', 'string']),
		rule(/[:{}]/, 'delimiter'),
		rule(/([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']),
		rule(comment, 'comment'),
		rule(/[A-Z_a-z-][\w$]*/, 'variable')
	],
	flowchart: [
		configDirective,
		rule(/[ox]?(--+|==+)[ox]/, 'transition'),
		rule(/[A-Za-z][\w$]*/, flowchartWords),
		rule(/\|+.+?\|+/, 'string'),
		rule(/\[+(\\.+?[/\\]|\/.+?[/\\])]+/, 'string'),
		rule(/[>[]+[^[\]|]+?]+/, 'string'),
		rule(/{+.+?}+/, 'string'),
		rule(/\(+.+?\)+/, 'string'),
		rule(/-\.+->?/, 'transition'),
		rule(/(-[.-])([^>-][^-]+?)(-{3,}|-{2,}>|\.-+>)/, ['transition', 'string', 'transition']),
		rule(/(==+)([^=]+?)(={3,}|={2,}>)/, ['transition', 'string', 'transition']),
		rule(/<?(--+|==+)>|===+|---+/, 'transition'),
		rule(/:::/, 'transition'),
		rule(/[&;]/, 'delimiter'),
		rule(/".*?"/, 'string'),
		rule(comment, 'comment')
	],
	gantt: [
		configDirective,
		rule(/(title)(.*)/, ['keyword', 'string']),
		rule(/(section)(.*)/, ['typeKeyword', 'string']),
		rule(/^\s*([^\n:]*?)(:)/, ['string', 'delimiter']),
		rule(/[A-Za-z][\w$]*/, ganttWords),
		rule(comment, 'comment'),
		rule(/:/, 'delimiter')
	],
	gitGraph: [
		configDirective,
		rule(/option(?=s)/, 'typeKeyword', 'optionsGitGraph'),
		rule(/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter', 'string']),
		rule(/(^\s*branch)(.*?)(\s+order)(:\s*)(\d+\s*$)/, [
			'keyword',
			'variable',
			'keyword',
			'delimiter',
			'number'
		]),
		rule(/".*?"/, 'string'),
		rule(/(^\s*)(branch|reset|merge|checkout)(\s*\S+)/, ['delimiter', 'keyword', 'variable']),
		rule(/[A-Za-z][\w$]*/, gitGraphWords),
		rule(comment, 'comment'),
		rule(/\^/, 'delimiter')
	],
	// The options of a git graph are JSON, up to `end`.
	optionsGitGraph: [
		rule('end', 'typeKeyword', '@pop'),
		rule(/s$/, 'typeKeyword'),
		rule(/.+?(?=end|$)/, 'string')
	],
	info: [rule(/[A-Za-z][\w$]*/, cases([], ['showInfo']))],
	journey: [
		configDirective,
		rule(/(title)(.*)/, ['keyword', 'string']),
		rule(/(section)(.*)/, ['typeKeyword', 'string']),
		rule(/[A-Za-z][\w$]*/, journeyWords),
		rule(/(^\s*.+?)(:)(.*?)(:)(.*?)([$,])/, [
			'string',
			'delimiter',
			'number',
			'delimiter',
			'variable',
			'delimiter'
		]),
		rule(/,/, 'delimiter'),
		rule(/(^\s*.+?)(:)([^:]*?)$/, ['string', 'delimiter', 'variable']),
		rule(comment, 'comment')
	],
	pie: [
		configDirective,
		rule(/(title|accDescription)(.*$)/, ['keyword', 'string']),
		rule(/[A-Za-z][\w$]*/, pieWords),
		rule(/".*?"/, 'string'),
		rule(/\s*\d+/, 'number'),
		rule(/:/, 'delimiter'),
		rule(comment, 'comment')
	],
	requirementDiagram: [
		configDirective,
		rule(/->|<-|-/, 'transition'),
		rule(/(\d+\.)*\d+/, 'number'),
		rule(/[A-Z_a-z-][\w$]*/, requirementWords),
		rule(/[/:{}]/, 'delimiter'),
		rule(comment, 'comment'),
		rule(/".*?"/, 'string')
	],
	sankey: [
		configDirective,
		rule(/(title)(.*)/, ['keyword', 'string']),
		rule(/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter', 'string']),
		rule(/".*?"/, 'string'),
		rule(/[A-Za-z]+/, 'string'),
		rule(/\s*\d+/, 'number'),
		rule(/,/, 'delimiter'),
		rule(comment, 'comment')
	],
	sequenceDiagram: [
		configDirective,
		rule(/(title:?|accDescription)([^\n\r;]*$)/, ['keyword', 'string']),
		rule(/(autonumber)([^\S\n\r]+off[^\S\n\r]*$)/, ['keyword', 'keyword']),
		rule(/(autonumber)((?:[^\S\n\r]+\d+){2}[^\S\n\r]*$)/, ['keyword', 'number']),
		rule(/(autonumber)([^\S\n\r]+\d+[^\S\n\r]*$)/, ['keyword', 'number']),
		rule(/(link\s+)(.*?)(:)(\s*.*?)(\s*@)(\s*[^\n\r;]+)/, [
			'keyword',
			'variable',
			'delimiter',
			'string',
			'delimiter',
			'string'
		]),
		// Links and properties are JSON, to the end of the line.
		rule(/((?:links|properties)\s+)([^\n\r:]*?)(:\s+)(.*)/, [
			'keyword',
			'variable',
			'delimiter',
			'string'
		]),
		rule(/right of|left of/, 'keyword'),
		rule(/[A-Za-z][\w$]*/, sequenceWords),
		rule(/(--?>?>|--?[)x])[+-]?/, 'transition'),
		rule(/(:)([^\n:]*?$)/, ['delimiter', 'string']),
		rule(comment, 'comment')
	],
	stateDiagram: [
		configDirective,
		rule(/note[^:]*$/, 'typeKeyword', 'stateDiagramNote'),
		rule('hide empty description', 'keyword'),
		rule(/^\s*state\s(?!.*{)/, 'keyword'),
		rule(/(<<)(fork|join|choice)(>>)/, 'annotation'),
		rule(/(\[\[)(fork|join|choice)(]])/, ['delimiter', 'annotation', 'delimiter']),
		rule(/[A-Za-z][\w$]*/, stateWords),
		rule(/".*?"/, 'string'),
		rule(/(:)([^\n:]*?$)/, ['delimiter', 'string']),
		rule(/{|}/, 'delimiter'),
		rule(comment, 'comment'),
		rule(/-->/, 'transition'),
		rule(/\[.*?]/, 'string')
	],
	stateDiagramNote: [rule(/^\s*end note$/, 'typeKeyword', '@pop'), rule(/.*/, 'string')],
	// The kinds the Live Editor has no rules for: their names, strings, numbers and comments.
	other: [
		configDirective,
		rule(/".*?"/, 'string'),
		rule(/-?\d+(?:\.\d+)?/, 'number'),
		rule(/[:,{}()[\]]/, 'delimiter'),
		rule(comment, 'comment')
	]
};

interface State {
	/** The states entered, the current one last. */
	stack: string[];
	/** The rest of what the last rule matched: the length and the style of each of its groups. */
	pending: [number, Style][];
}

const mermaid = StreamLanguage.define<State>({
	name: 'mermaid',
	startState: () => ({ stack: ['root'], pending: [] }),
	copyState: (state) => ({ stack: [...state.stack], pending: [...state.pending] }),
	token(stream, state) {
		const pending = state.pending.shift();
		if (pending) {
			stream.pos += pending[0];
			return pending[1];
		}
		const current = state.stack.at(-1) ?? 'root';
		// A kind of diagram the rules of the root do not name.
		if (current === 'root' && stream.sol() && DIAGRAM_START.test(stream.string.trim())) {
			if (!STATES.root.some((root) => root.pattern.test(stream.string))) {
				stream.skipToEnd();
				state.stack.push('other');
				return 'typeKeyword';
			}
		}
		for (const { pattern, atLineStart, action, next } of STATES[current]) {
			if (atLineStart && !stream.sol()) continue;
			const match = stream.match(pattern, false) as RegExpMatchArray | null;
			if (!match || match[0] === '') continue;
			if (next === '@pop') {
				if (state.stack.length > 1) state.stack.pop();
			} else if (next) {
				state.stack.push(next);
			}
			if (Array.isArray(action)) {
				const groups = match
					.slice(1)
					.map((group, index): [number, Style] => [group?.length ?? 0, action[index] ?? null]);
				// Groups cover the match; anything they leave goes with the last.
				const covered = groups.reduce((sum, [length]) => sum + length, 0);
				if (groups.length > 0) groups[groups.length - 1][0] += match[0].length - covered;
				state.pending = groups.filter(([length]) => length > 0);
				const [length, style] = state.pending.shift() ?? [match[0].length, null];
				stream.pos += length;
				return style;
			}
			stream.pos += match[0].length;
			return typeof action === 'function' ? action(match[0]) : action;
		}
		stream.next();
		return null;
	},
	tokenTable: {
		typeKeyword: tags.definitionKeyword,
		keyword: tags.keyword,
		string: tags.string,
		transition: tags.operator,
		delimiter: tags.punctuation,
		annotation: tags.annotation,
		number: tags.number,
		comment: tags.lineComment,
		variable: tags.variableName,
		type: tags.typeName,
		meta: tags.meta
	},
	languageData: { commentTokens: { line: '%%' } }
});

// The Live Editor's highlighting, in the colours the editor gives other documents.
const colours = HighlightStyle.define([
	{ tag: tags.definitionKeyword, color: 'var(--json-boolean)', fontWeight: '600' },
	{ tag: tags.keyword, color: 'var(--json-boolean)' },
	{ tag: tags.variableName, color: 'var(--json-container)' },
	{ tag: tags.string, color: 'var(--json-string)' },
	{ tag: [tags.number, tags.typeName], color: 'var(--json-number)' },
	{ tag: tags.annotation, color: 'var(--json-container)', fontStyle: 'italic' },
	{ tag: tags.operator, color: 'var(--brand)', fontWeight: '600' },
	{ tag: [tags.punctuation, tags.meta], color: 'var(--muted-foreground)' },
	{ tag: tags.lineComment, color: 'var(--muted-foreground)', fontStyle: 'italic' }
]);

/** What the editor knows of Mermaid. */
export function mermaidLanguage(): Extension {
	return [mermaid, syntaxHighlighting(colours)];
}
