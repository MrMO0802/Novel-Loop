import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  outputDir: 'test-results',
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: '/tmp/novel-loop-desktop-playwright-report' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'off'
  },
  webServer: {
    command: 'corepack pnpm exec vite preview --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'desktop-1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 720 } }
    }
  ]
});
