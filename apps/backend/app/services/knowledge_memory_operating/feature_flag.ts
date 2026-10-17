/**
 * v3-knowledge-memory-operating-layer —— feature flag（§4.1 / §4.2）。
 *
 * 名称：`KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED`。
 * 默认：关闭（`false`）。
 *
 * 行为：
 * - off：路由 feature-off；聚合器 / adapter / Service 一律不被调用；
 *   既有 `/knowledge`、`/ai/memory`、Compiler Skill authoring 端点保持原样。
 * - on：注册 3 个 GET endpoint；新增 view 在既有 `/knowledge` 中以 `view=operations`
 *   暴露。
 *
 * 解析顺序（高 → 低优先级）：
 * 1. `process.env.KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED`（CI / 部署覆盖）
 * 2. `app_settings` / `feature_flags` 配置（生产配置；本轮不实现，仅占位）
 * 3. 默认值（`false`）
 *
 * @aiproj/backend
 */

export const KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV =
  'KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED'

/**
 * 读取 feature flag 当前值。设计为无副作用纯函数（仅在调用时读 process.env）。
 *
 * 接受值：`'1' | 'true' | 'on' | 'yes' | 'enabled'`（大小写不敏感） → true；
 * 其余 → false；缺省 → false。
 */
export function isKnowledgeMemoryOperatingLayerEnabled(
  now: Readonly<{
    env?: NodeJS.ProcessEnv
  }> = {},
): boolean {
  const env = now.env ?? process.env
  const raw = env[KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV]
  if (raw === undefined || raw === null) return false
  return /^(1|true|on|yes|enabled)$/i.test(String(raw).trim())
}

/**
 * 静态断言：flag off 时调用本函数应返回 `false`，并阻止 4 port 任何调用。
 * 用于路由注册时 gate：
 *   if (!isKnowledgeMemoryOperatingLayerEnabled()) return
 */
export function assertFlagOffNoop(): boolean {
  return !isKnowledgeMemoryOperatingLayerEnabled()
}
