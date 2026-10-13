import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'pnpm run preview --port 4173', port: 4173, timeout: 180_000 },
	testMatch: '**/*.e2e.{ts,js}'
});
