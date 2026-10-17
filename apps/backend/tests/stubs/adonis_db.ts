/**
 * AdonisJS Lucid DB 服务的 Vitest 桩。
 *
 * 背景：`@adonisjs/lucid/services/db` 是容器服务，模块加载即取已 boot 的 app。
 * CopilotProjectPanoramaAggregator 在顶层 import 它，导致 vitest 下
 * 任何间接依赖该模块的被测模块整文件加载失败。
 *
 * 桩只需保证「能被 import、方法可调用」；DB 查询不是这些单测的被测行为。
 */
const db = {
  booted: true,
  from: () => ({ query: () => ({ where: () => ({ select: () => Promise.resolve([]) }) }) }),
  query: () => ({ where: () => ({ select: () => Promise.resolve([]) }) }),
}

export default db
