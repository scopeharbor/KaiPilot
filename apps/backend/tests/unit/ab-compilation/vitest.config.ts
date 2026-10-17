/**
 * Compiler A/B 单元测试 vitest 配置。
 * 纯 TypeScript 逻辑测试，不依赖 AdonisJS 运行时/数据库。
 *
 * 由于 pnpm workspace 执行时 cwd = apps/backend，
 * 路径要相对于 backend 目录。
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const backendDir = path.resolve(__dirname, '../../')

export default defineConfig({
  resolve: {
    alias: {
      '#services': path.resolve(backendDir, 'app/services'),
      '#services/compiler': path.resolve(backendDir, 'app/services/compiler'),
      '#services/compiler/ab-compilation': path.resolve(
        backendDir,
        'app/services/compiler/ab-compilation',
      ),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/unit/ab-compilation/**/*.spec.ts'],
    exclude: [],
  },
})
