import { defineConfig } from '@playwright/test'

// Uses installed Edge by default. Set PLAYWRIGHT_CHANNEL=chromium after installing
// Playwright Chromium on hosts without Edge.
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'development', testMatch: 'editor.browser.spec.ts', use: { baseURL: 'http://127.0.0.1:4331' } },
    { name: 'production', testMatch: 'local-save.production.spec.ts', use: { baseURL: 'http://127.0.0.1:4332' } },
  ],
  webServer: [
    { command: 'node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4331', url: 'http://127.0.0.1:4331/editor/', reuseExistingServer: false, env: { ASTRO_TELEMETRY_DISABLED: '1' }, timeout: 120000 },
    { command: 'node node_modules/astro/bin/astro.mjs preview --host 127.0.0.1 --port 4332', url: 'http://127.0.0.1:4332/editor/', reuseExistingServer: false, env: { ASTRO_TELEMETRY_DISABLED: '1' }, timeout: 60000 },
  ],
})
