import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo-browser',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview:demo',
    url: 'http://127.0.0.1:4173',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
