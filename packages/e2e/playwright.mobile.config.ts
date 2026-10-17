import { defineConfig } from '@playwright/test'

// Uses a seeded local development instance; never resets an existing database.
// Start the frontend with NEXT_PUBLIC_FF_NEXT_UI=true and disable real AI providers.
export default defineConfig({
  testDir: './mobile',
  testMatch: /mobile-(workspace|interactions|theme|platform-models)\.spec\.ts/,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: './test-results/mobile',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    navigationTimeout: 120_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    {
      name: 'phone-320',
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-390',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-430',
      use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-landscape',
      use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
})
