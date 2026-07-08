import { defineConfig } from '@playwright/test';

// e2e regression net (J1 Phase 3) — journeys + golden screenshots against
// the real vite dev server. Deliberately outside tsconfig's "src" include.
export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    env: { NOVAKAI_PTY_CMD: 'echo ready; exec cat' },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
