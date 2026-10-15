/**
 * Formatter worker: formats the one text it is sent, in the language it is
 * sent, with the WebAssembly formatter it is sent, and answers with the
 * result or with why there is none.
 */
import init, { format_json, format_yaml } from '#formatter';
import type { FormatRequest, Formatted } from './format';

addEventListener('message', async ({ data }: MessageEvent<FormatRequest>) => {
	let answer: Formatted;
	try {
		await init({ module_or_path: data.module });
		const format = data.language === 'yaml' ? format_yaml : format_json;
		answer = { text: format(data.text), error: null };
	} catch (error) {
		answer = { text: null, error: error instanceof Error ? error.message : String(error) };
	}
	postMessage(answer);
});
