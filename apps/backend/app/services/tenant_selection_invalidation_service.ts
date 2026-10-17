// @aiproj/backend — TenantSelectionInvalidationService（v3-multitenant-tenant-identification §4.3）。
//
// spec「Tenant selection MUST support explicit organization switching」要求：切换成功后
// **必须失效**前一组织的 preview、export handle、job handle、AI/Compiler context handle
// 与前端查询缓存（design Decision 3：切换不自动重放旧草稿/预览/导出/job/AI run）。
//
// 两种失效手段，按目标可达性分派：
//
//  1. **主动清理**（`invalidated`）：服务端能直接枚举并删除的——组织范围内的服务端缓存条目
//     （`CacheStore.invalidateByScope`，结构性以 `org:<id>:` 前缀为界，不越组织）。
//
//  2. **epoch 栅栏**（`fenced`）：无状态派生值（预览签名、导出句柄、job/AI/Compiler 续跑句柄）
//     不落库、无法逐条删除，因此靠 `tenant_selection_states.selection_epoch` 单调递增作栅栏：
//     句柄签发时带上当时的 epoch，消费时与服务端当前 epoch 比对，不等即 stale。
//     **不带 epoch 的旧格式句柄一律判 stale**（fail closed），而不是当成有效。
//     这条正是"切回原组织后旧预览也必须失效"的实现依据——scope hash 会随切回而复原，
//     只有 epoch 单调递增才拦得住。
//
//  3. 前端 TanStack Query 缓存由后端**指令化**返回（`client_directed`），前端 §8.2 执行；
//     后端无法代替浏览器清缓存，但把"该清什么 scope"作为低敏指令下发，避免前端自行猜测。
//
// 低敏保证：报告只含目标枚举、状态枚举、计数与 scope hash；不含缓存值、raw key、
// 句柄本体、组织名称或任何隐藏资源信息。

import type { CacheStore } from './cache/cache_store.js'

/** 受本服务治理的租户派生句柄种类。 */
export const TENANT_SELECTION_DERIVED_TARGETS = [
  'server_cache',
  'preview_signature',
  'export_handle',
  'job_handle',
  'ai_context_handle',
  'compiler_context_handle',
  'query_cache',
] as const
export type TenantSelectionDerivedTarget = (typeof TENANT_SELECTION_DERIVED_TARGETS)[number]

/**
 * 失效状态：
 * - `invalidated`     已主动清除（附 removedCount）
 * - `fenced`          由 selection epoch 栅栏失效（旧 epoch 句柄消费时判 stale）
 * - `client_directed` 需客户端执行（前端查询缓存）
 * - `degraded`        清理不可用（如缓存后端异常），但隔离不降级：仍有 epoch 栅栏兜底
 */
export type TenantSelectionInvalidationStatus =
  'invalidated' | 'fenced' | 'client_directed' | 'degraded'

export interface TenantSelectionInvalidationEntry {
  target: TenantSelectionDerivedTarget
  status: TenantSelectionInvalidationStatus
  /** 主动清理的条目计数（仅 `invalidated`/`degraded` 有意义）。 */
  removedCount?: number
}

/** 低敏失效报告：可安全进入响应体与审计。 */
export interface TenantSelectionInvalidationReport {
  /** 切换后的新 epoch；旧 epoch 句柄据此判 stale。 */
  selectionEpoch: number
  previousScopeHash: string | null
  nextScopeHash: string
  entries: TenantSelectionInvalidationEntry[]
}

export interface TenantSelectionInvalidationInput {
  actorRef: string
  /** 切换前的组织（首次选择时为 null）。 */
  previousOrganizationId: number | null
  nextOrganizationId: number
  previousScopeHash: string | null
  nextScopeHash: string
  /** 切换后的新 epoch（由 TenantSelectionStateService 递增后传入）。 */
  selectionEpoch: number
  /** 可选缓存后端；不可用时该目标降级为 `degraded`，隔离仍由 epoch 栅栏保证。 */
  cache?: CacheStore | null
}

/** epoch 栅栏复核入参。 */
export interface TenantSelectionFreshnessInput {
  /** 句柄签发时携带的 epoch；旧格式句柄没有它 → 判 stale。 */
  handleEpoch?: number | null
  /** 服务端当前 epoch。 */
  currentEpoch: number
  /** 句柄签发时的组织。 */
  handleOrganizationId?: number | null
  /** 当前有效租户组织。 */
  currentOrganizationId: number | null
}

export default class TenantSelectionInvalidationService {
  /**
   * 组织切换成功后失效前一租户派生制品。
   *
   * 注意本方法**不抛异常**：失效是"尽力而为的清理 + 必定生效的 epoch 栅栏"组合，
   * 清理失败不应让一次合法切换失败（切换本身已经把 epoch 推进了，安全性不依赖清理）。
   */
  async invalidateForSwitch(
    input: TenantSelectionInvalidationInput,
  ): Promise<TenantSelectionInvalidationReport> {
    const entries: TenantSelectionInvalidationEntry[] = []

    // 1. 服务端缓存：清前一组织范围内的条目（首次选择无前一组织，则跳过清理）。
    if (input.previousOrganizationId === null) {
      entries.push({ target: 'server_cache', status: 'fenced' })
    } else if (!input.cache) {
      // 缓存后端不可用（本机无 Redis 且未注入内存实现）：降级但不失去隔离。
      entries.push({ target: 'server_cache', status: 'degraded', removedCount: 0 })
    } else {
      try {
        // keyPrefix 传空串 = 该组织范围内全部条目；invalidateByScope 结构性不越组织。
        const result = await input.cache.invalidateByScope(input.previousOrganizationId, '')
        entries.push({
          target: 'server_cache',
          status: result.degraded ? 'degraded' : 'invalidated',
          removedCount: result.removedCount,
        })
      } catch {
        entries.push({ target: 'server_cache', status: 'degraded', removedCount: 0 })
      }
    }

    // 2. 无状态派生句柄：epoch 栅栏（消费时比对，见 isSelectionFresh）。
    for (const target of [
      'preview_signature',
      'export_handle',
      'job_handle',
      'ai_context_handle',
      'compiler_context_handle',
    ] as const) {
      entries.push({ target, status: 'fenced' })
    }

    // 3. 前端查询缓存：指令化下发，由 §8.2 前端执行。
    entries.push({ target: 'query_cache', status: 'client_directed' })

    return {
      selectionEpoch: input.selectionEpoch,
      previousScopeHash: input.previousScopeHash,
      nextScopeHash: input.nextScopeHash,
      entries,
    }
  }

  /**
   * epoch 栅栏复核：判断一个派生句柄是否仍属于当前 selection。
   *
   * 三条 fail-closed 规则：
   *  - 句柄没带 epoch（旧格式）→ 不新鲜；
   *  - epoch 与服务端当前值不等（含句柄 epoch 更大的异常情况）→ 不新鲜；
   *  - 句柄组织与当前有效租户组织不一致 → 不新鲜（跨租重放）。
   */
  isSelectionFresh(input: TenantSelectionFreshnessInput): boolean {
    // 注意用 `?? null` 归一化再比较，而不是 `== null`：后者虽然同时覆盖 null 与 undefined，
    // 但 eqeqeq 门禁禁用它，而直接改成 `!== null` 会漏掉 undefined 分支（旧格式句柄
    // 恰恰是字段缺失 = undefined），那正是必须判 stale 的情况。
    const handleEpoch = input.handleEpoch ?? null
    if (handleEpoch === null) return false
    if (handleEpoch !== input.currentEpoch) return false
    const handleOrganizationId = input.handleOrganizationId ?? null
    if (handleOrganizationId !== null && handleOrganizationId !== input.currentOrganizationId) {
      return false
    }
    return true
  }
}
