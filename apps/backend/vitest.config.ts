/**
 * v3-copilot-live-submission-channel —— 后端 Vitest 运行器配置。
 *
 * 背景：后端 `tests/` 下有大量纯逻辑 spec `import ... from 'vitest'`，
 * 但此前**没有任何 vitest 运行器配置，也没有 test:unit 脚本**——它们既被 Japa
 * 排除、又无人执行，断言从未真正跑过。本配置把它们接回门禁。
 *
 * include 与 Japa 的 exclude 共用 `tests/vitest_style_specs.ts` 的同一份内容判定，
 * 两侧不会漂移：Japa 跑依赖 AdonisJS 运行时的 spec，Vitest 跑其余的。
 */

import { defineConfig } from 'vitest/config'
import { listVitestStyleSpecs } from './tests/vitest_style_specs.js'

const vitestStyleSpecs = listVitestStyleSpecs()

export default defineConfig({
  // Vite 8 改用 Oxc 转译，且会自行读取 tsconfig 的 emitDecoratorMetadata，为 `@inject()` 类
  // 生成 `design:paramtypes`，把构造参数类型（RbacService → Lucid Model → 顶层 await 已
  // boot 的 hash 等容器服务）变成值引用，裸 node 单测整文件加载失败。Vitest 3 的 esbuild
  // 不生成该元数据，单测本就手动注入依赖——沿用该行为。tsconfig 会覆盖显式选项，故关闭
  // tsconfig 读取并显式声明 legacy 装饰器（`#…` 子路径已由下方 alias 解析，不依赖 tsconfig）。
  oxc: {
    tsconfig: false,
    decorator: { legacy: true, emitDecoratorMetadata: false },
  },
  resolve: {
    // 本仓库按 NodeNext 写相对导入（`./x.js` 指向 `./x.ts`）。Vitest 需要显式映射回 .ts，
    // 否则 `import ... from '#services/.../x.js'` 与 `require('#services/...')` 都会
    // module-not-found（与 apps/frontend 的 vitest.config.ts 同一处理）。
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    // 无 vitest 风格 spec 时给一个不匹配任何文件的模式，避免 vitest 回落到默认 glob
    // 而误加载 Japa 风格 spec。
    include: vitestStyleSpecs.length > 0 ? [...vitestStyleSpecs] : ['tests/__none__.spec.ts'],
    passWithNoTests: true,
    // 后端 spec 常在首个用例里动态 import 整条服务模块图（冷加载数秒）。
    // 默认 5s 在全量并行下会把"加载慢"误判成失败——单跑通过、全量失败即此因。
    testTimeout: 30_000,
    setupFiles: ['./tests/vitest_setup.ts'],
    environment: 'node',
    // AdonisJS 的 `#services/*` 等子路径导入在 vitest 下需要显式解析
    alias: {
      '#services': new URL('./app/services/', import.meta.url).pathname,
      '#models': new URL('./app/models/', import.meta.url).pathname,
      '#controllers': new URL('./app/controllers/', import.meta.url).pathname,
      '#validators': new URL('./app/validators/', import.meta.url).pathname,
      '#policies': new URL('./app/policies/', import.meta.url).pathname,
      '#exceptions': new URL('./app/exceptions/', import.meta.url).pathname,
      '#middleware': new URL('./app/middleware/', import.meta.url).pathname,
      '#database': new URL('./database/', import.meta.url).pathname,
      '#start': new URL('./start/', import.meta.url).pathname,
      '#config': new URL('./config/', import.meta.url).pathname,
      '#tests': new URL('./tests/', import.meta.url).pathname,
      // 容器服务在裸 node 下未 boot：用无副作用替身，避免顶层 import 直接炸掉整个文件
      '@adonisjs/core/services/server': new URL('./tests/stubs/adonis_server.ts', import.meta.url)
        .pathname,
      '@adonisjs/core/services/logger': new URL('./tests/stubs/adonis_logger.ts', import.meta.url)
        .pathname,
      '@adonisjs/lucid/services/db': new URL('./tests/stubs/adonis_db.ts', import.meta.url)
        .pathname,
    },
  },
})
