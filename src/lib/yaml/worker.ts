/**
 * Turns the one YAML document it is sent into JSON, off the graph's thread,
 * so that the graph can still be moved while a large one is read.
 */
import { yamlToJson } from './to-json';

/** What the worker answers: the document as JSON, or why there is none. */
export type Converted = { json: Blob; error: null } | { json: null; error: string };

addEventListener('message', async ({ data }: MessageEvent<Blob>) => {
	let answer: Converted;
	try {
		const json = new Blob([yamlToJson(await data.text())], { type: 'application/json' });
		answer = { json, error: null };
	} catch (error) {
		answer = { json: null, error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(answer);
});
