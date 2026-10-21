import { defineConfig } from '@playwright/test'

delete process.env.NO_COLOR

export default defineConfig({
  testDir: './e2e',
  globalSetup: './global-setup.ts',
  timeout: 30000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
  },
  webServer: [
    {
      command: 'pnpm --filter @aiproj/backend dev',
      // 端到端流程用 Mock 模型联调（没有 AI 连接时后端默认提示添加连接，见 AI_ALLOW_MOCK）；
      // 登录期两步验证绑定默认 optional，会在密码通过后先给绑定挑战而不签发令牌，
      // 端到端账号不绑定认证器，这里关掉（两步验证本身另有后端与前端用例覆盖）
      env: { AI_ALLOW_MOCK: 'true', TWO_FACTOR_LOGIN_ENROLLMENT: 'off' },
      url: 'http://localhost:3333',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter @aiproj/frontend dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
})
