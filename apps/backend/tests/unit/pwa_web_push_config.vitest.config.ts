/**
 * PWA Web Push 配置单元测试 vitest 配置。
 * 纯 TypeScript 逻辑测试，不依赖 AdonisJS 运行时。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/tests/unit/pwa_web_push_config.spec.ts'],
    exclude: [],
  },
})
