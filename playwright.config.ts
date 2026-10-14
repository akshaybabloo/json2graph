import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm run preview --port 4173',
		port: 4173,
		timeout: 180_000,
		// What a deployment is given from its tag, for the page to show.
		env: { APP_VERSION: '0.0.0' }
	},
	testMatch: '**/*.e2e.{ts,js}'
});
