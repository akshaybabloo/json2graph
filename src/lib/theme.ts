/**
 * Light and dark mode. The mode is the `dark` class on the root element, which
 * the design tokens in `src/routes/layout.css` key off. `src/app.html` applies
 * the stored choice (or the system preference) before the first paint.
 */

/** Must match the key read in `src/app.html`. */
const STORAGE_KEY = 'theme';

/** Switches between light and dark, and remembers the choice. */
export function toggleTheme() {
	const dark = document.documentElement.classList.toggle('dark');
	try {
		localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
	} catch {
		// Storage can be unavailable; the choice then lasts until the page is closed.
	}
}
