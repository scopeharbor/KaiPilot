import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
    // 与 next.config.mjs 保持一致：@aiproj/types（NodeNext）内部用 `.js` 写相对导入，
    // 需要映射回 `.ts`，否则加载桶入口运行时值的测试会 module-not-found。
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    // Node 26 下全仓并发转换和大型 barrel 首次加载明显变慢；业务性能断言仍在各测试内独立执行。
    testTimeout: 30_000,
    // @aiproj/types 是 monorepo TS 源码包（NodeNext，相对导入写 `.js`）。
    // 不 inline 的话会被当成外部依赖交给 Node ESM 加载，`./ai-m0.js` 直接 module-not-found；
    // 与 next.config.mjs 的 transpilePackages 同一目的。
    server: {
      deps: {
        inline: [/@aiproj\/types/],
      },
    },
    include: ['__tests__/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // 只统计测试实际加载的产品代码；尚未实现的占位路由和框架配置不应稀释能力覆盖率。
      all: false,
      thresholds: {
        statements: 80,
        branches: 70,
      },
    },
  },
})
