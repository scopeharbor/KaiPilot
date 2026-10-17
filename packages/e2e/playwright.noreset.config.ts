import { defineConfig } from '@playwright/test'

delete process.env.NO_COLOR

export default defineConfig({
  testDir: './e2e',
  timeout: 200000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
  },
  // 无 globalSetup：避免 migration/db:seed 触发 backend watch 重启打断进行中的分析请求。
  webServer: [
    {
      command: 'pnpm --filter @aiproj/backend dev',
      url: 'http://localhost:3333',
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter @aiproj/frontend dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
})
