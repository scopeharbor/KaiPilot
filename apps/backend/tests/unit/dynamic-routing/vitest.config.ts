/**
 * Dynamic Routing 单元测试的 vitest 配置。
 * 纯 TypeScript 逻辑，不依赖 AdonisJS 运行时。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/tests/unit/dynamic-routing/*.spec.ts'],
    exclude: [],
  },
})
