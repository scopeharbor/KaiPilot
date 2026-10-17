/**
 * 构建期 codegen：在干净 checkout 中生成 `.adonisjs/server/*` 索引
 * （controllers/events/listeners 等）与 `.adonisjs/client/{data,manifest}.d.ts`。
 *
 * 背景（2026-08-27 GCP clean Docker build blocker）：
 * - `start/routes.ts` 依赖 `#generated/controllers`（→ `.adonisjs/server/controllers.ts`）。
 * - 该索引由 adonisrc.ts `hooks.init` 的 `indexEntities` 在 `node ace build` /
 *   dev server 启动时生成；`.adonisjs` 目录 gitignored，干净 clone 中不存在。
 * - `migration:run` / `schema:generate` 是 startApp:true 命令，boot 会 preload
 *   routes → 需要 `#generated/controllers` → 形成「迁移需要索引、索引由 build
 *   生成、build 又需要迁移产物 schema.ts」的循环依赖。
 * - 本脚本只运行 init 钩子中的 IndexGenerator 注册并生成索引，不启动应用、
 *   不加载路由，从而打破循环：codegen:indexes → migration:run → schema:generate → build。
 *
 * 复用 adonisrc.ts 的同一份 hooks.init 配置（不重复声明，零漂移）；
 * tuyau 的 generateRegistry 会注册 routesScanning/routesScanned 子钩子——
 * 这些只在完整 bundler 流程中触发，独立运行时以 no-op 注册表跳过
 * （client registry 由正式 `node ace build` 照常生成）。
 */

import { fileURLToPath } from 'node:url'
import { cliui } from '@poppinss/cliui'
import { IndexGenerator } from '@adonisjs/assembler/index_generator'
import rcConfig from '../adonisrc.js'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/$/, '')
const generator = new IndexGenerator(appRoot, cliui().logger)

// init 钩子在 rcfile 类型中是 LazyImport | { run } 联合；与 assembler loadHooks
// 一样先做归一化。hooks 注册表以 no-op 桩传入：tuyau generateRegistry 的
// routesScanning/routesScanned 子钩子只在完整 bundler 流程触发，此处跳过。
interface InitHookObject {
  run: (...args: unknown[]) => unknown
}

async function resolveHook(hook: unknown): Promise<InitHookObject> {
  const resolved = typeof hook === 'function' ? await (hook as () => unknown)() : hook
  return resolved as InitHookObject
}

const hooksRegistryStub = { add() {} }

for (const hook of rcConfig.hooks?.init ?? []) {
  const obj = await resolveHook(hook)
  await obj.run(undefined, hooksRegistryStub, generator)
}

await generator.generate()
