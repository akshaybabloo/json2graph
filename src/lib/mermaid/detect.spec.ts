import { describe, expect, it } from 'vitest';
import { looksLikeMermaid } from './detect';

describe('looksLikeMermaid', () => {
	it('knows a diagram by the line that names its kind', () => {
		expect(looksLikeMermaid('flowchart LR\n  A --> B\n')).toBe(true);
		expect(looksLikeMermaid('graph TD;\nA-->B')).toBe(true);
		expect(looksLikeMermaid('sequenceDiagram\n  Alice->>Bob: Hi')).toBe(true);
		expect(looksLikeMermaid('pie title Pets\n  "Dogs" : 386')).toBe(true);
		expect(looksLikeMermaid('gantt\n  title A plan')).toBe(true);
		expect(looksLikeMermaid('stateDiagram-v2\n  [*] --> Still')).toBe(true);
	});

	it('looks past comments, directives and front matter', () => {
		expect(looksLikeMermaid('%% A comment\n\n%%{init: {"theme": "dark"}}%%\nmindmap\n  root')).toBe(
			true
		);
		expect(looksLikeMermaid('---\ntitle: Flow\nconfig:\n  look: neo\n---\nflowchart TB\n')).toBe(
			true
		);
	});

	it('takes no prose, YAML or table for a diagram', () => {
		expect(looksLikeMermaid('timeline of the project, in short')).toBe(false);
		expect(looksLikeMermaid('graph: true\nnodes: 3\n')).toBe(false);
		expect(looksLikeMermaid('---\na: 1\n')).toBe(false);
		expect(looksLikeMermaid('pie,cake\n1,2\n')).toBe(false);
		expect(looksLikeMermaid('{"graph": "TD"}')).toBe(false);
	});
});
