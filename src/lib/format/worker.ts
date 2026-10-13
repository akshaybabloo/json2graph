/**
 * Formatter worker: formats the one text it is sent with the WebAssembly
 * formatter, and answers with the result or with why there is none.
 */
import init, { format_json } from '#formatter';
import type { Formatted } from './format';

addEventListener('message', async (event: MessageEvent<string>) => {
	let answer: Formatted;
	try {
		await init();
		answer = { text: format_json(event.data), error: null };
	} catch (error) {
		answer = { text: null, error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(answer);
});
