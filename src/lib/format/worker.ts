/**
 * Formatter worker: formats the one text it is sent with the WebAssembly
 * formatter it is sent, and answers with the result or with why there is none.
 */
import init, { format_json } from '#formatter';
import type { FormatRequest, Formatted } from './format';

addEventListener('message', async ({ data }: MessageEvent<FormatRequest>) => {
	let answer: Formatted;
	try {
		await init({ module_or_path: data.module });
		answer = { text: format_json(data.text), error: null };
	} catch (error) {
		answer = { text: null, error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(answer);
});
