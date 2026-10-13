import wasm from '#formatter/wasm?url';

/** What the formatter worker is sent: the compiled formatter and the text for it. */
export type FormatRequest = { module: WebAssembly.Module; text: string };

/** What the formatter worker answers: the formatted text, or why there is none. */
export type Formatted = { text: string; error: null } | { text: null; error: string };

let compiled: Promise<WebAssembly.Module> | undefined;

/**
 * The formatter, fetched and compiled once. It is large, so that waits until
 * something is formatted; every worker after that starts from the same copy.
 */
function formatter(): Promise<WebAssembly.Module> {
	compiled ??= WebAssembly.compileStreaming(fetch(wasm)).catch(() => {
		// Fetch it again the next time, rather than keep the failure.
		compiled = undefined;
		throw new Error('The formatter could not be loaded');
	});
	return compiled;
}

/**
 * Re-indents JSON text with Biome's formatter. Rejects when the text is not
 * JSON that Biome can read.
 *
 * Each call runs in a worker of its own, which is then stopped: that gives
 * back the memory that a large document took.
 */
export async function formatJson(text: string): Promise<string> {
	const module = await formatter();
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		worker.addEventListener('message', ({ data }: MessageEvent<Formatted>) => {
			worker.terminate();
			if (data.error === null) resolve(data.text);
			else reject(new Error(data.error));
		});
		worker.addEventListener('error', (event) => {
			worker.terminate();
			reject(new Error(event.message || 'The formatter could not be loaded'));
		});
		worker.postMessage({ module, text } satisfies FormatRequest);
	});
}
