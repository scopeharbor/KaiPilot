import { defineConfig } from '@playwright/test'

/**
 * 宿主机已跑服务场景的 E2E 配置（无 webServer 拉起）：
 * 前后端由外部编排器提供，baseURL 从环境变量注入。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 200000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
  },
  webServer: [],
})
