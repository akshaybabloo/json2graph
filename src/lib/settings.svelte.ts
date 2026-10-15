/**
 * What the user chose in Settings, kept in this browser. The page starts
 * from the defaults, as the server renders it, and takes the stored choices
 * once it runs (see `loadSettings`).
 */

/** How a connection between two nodes is drawn: a curve, or straight lines with sharp corners. */
export type Connections = 'curved' | 'sharp';

export interface Settings {
	connections: Connections;
	/** Whether the tabs are kept in this browser over a reload. */
	keepTabs: boolean;
	/** Whether a connection is labelled with the key of the node it leads to. */
	connectionKeys: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
	connections: 'curved',
	keepTabs: true,
	connectionKeys: false
};

const STORAGE_KEY = 'settings';

export const settings = $state<Settings>({ ...DEFAULT_SETTINGS });

/** Takes the choices kept in this browser; any that are missing or not understood stay as they are. */
export function loadSettings() {
	let stored: Partial<Record<keyof Settings, unknown>>;
	try {
		stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
	} catch {
		// Storage can be unavailable, or hold something else.
		return;
	}
	if (stored.connections === 'curved' || stored.connections === 'sharp') {
		settings.connections = stored.connections;
	}
	if (typeof stored.keepTabs === 'boolean') settings.keepTabs = stored.keepTabs;
	if (typeof stored.connectionKeys === 'boolean') settings.connectionKeys = stored.connectionKeys;
}

/** Makes `change`, and keeps the choices in this browser. */
export function changeSettings(change: Partial<Settings>) {
	Object.assign(settings, change);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage can be unavailable; the choice then lasts until the page is closed.
	}
}
