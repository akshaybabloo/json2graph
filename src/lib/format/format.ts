/** What the formatter worker answers: the formatted text, or why there is none. */
export type Formatted = { text: string; error: null } | { text: null; error: string };

/**
 * Re-indents JSON text with Biome's formatter. Rejects when the text is not
 * JSON that Biome can read.
 *
 * Each call runs in a worker of its own, which is then stopped. The formatter
 * is large, so it is not loaded until something is formatted, and stopping the
 * worker gives back the memory that a large document took.
 */
export function formatJson(text: string): Promise<string> {
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
		worker.postMessage(text);
	});
}
