import { defineConfig, devices } from '@playwright/test';

/**
 * E2E accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * The build runs as part of `webServer.command` — see the note there.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  webServer: {
    /*
     * Build first: `preview` only serves whatever is already in dist/. Without the
     * build, a failed compile leaves the previous good bundle on disk and the suite
     * passes green against source that no longer compiles, which silently
     * invalidates mutation checking. Building here makes a broken source abort the run.
     */
    command: 'npm run build && npm run preview -- --port 4322 --strictPort',
    url: 'http://localhost:4322/crypto-lab-timing-sidechannel/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: {
    baseURL: 'http://localhost:4322/crypto-lab-timing-sidechannel/',
    colorScheme: 'dark',
  },
});
