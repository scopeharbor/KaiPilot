// v3-resource-capacity-forecasting-closed-loop —— 五类来源 source adapter 框架（任务 4.1）。
//
// 红线：
// - adapter 只消费既有领域 Service/Policy 的授权结果，绝不直接查跨域表、不重算业务结论；
// - required 来源失败 → 基线不可模拟；optional 失败 → 仅降级；
// - 单来源超时 / 总预算 / 取消信号 / 截断标记统一由 collectSources 管理；
// - 输出按 sourceId 稳定排序；零网络（除既有 Service 自身的本地 DB 读取）。

import type { ResourceCapacityLoopWarningCode } from '@aiproj/types/resource-capacity-closed-loop'
import {
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  type RESOURCE_CAPACITY_LOOP_FACT_STATES,
} from '@aiproj/types/resource-capacity-closed-loop'

// ─── 来源身份与分类 ──────────────────────────────────────────────────────────

export const RCCL_SOURCE_IDS = {
  RESOURCE_POOL: 'organization-resource-pool',
  SKILL_MATRIX: 'resource-skill-matrix',
  DEMAND_FORECASTING: 'resource-demand-forecasting',
  GAP_ANALYSIS: 'resource-gap-analysis',
  CONTENTION_DETECTION: 'resource-contention-detection',
} as const

export type RcclSourceId = (typeof RCCL_SOURCE_IDS)[keyof typeof RCCL_SOURCE_IDS]

export const RCCL_REQUIRED_SOURCES: readonly RcclSourceId[] = [
  RCCL_SOURCE_IDS.RESOURCE_POOL,
  RCCL_SOURCE_IDS.DEMAND_FORECASTING,
  RCCL_SOURCE_IDS.GAP_ANALYSIS,
  RCCL_SOURCE_IDS.CONTENTION_DETECTION,
]

export const RCCL_OPTIONAL_SOURCES: readonly RcclSourceId[] = [RCCL_SOURCE_IDS.SKILL_MATRIX]

export function isRequiredSource(sourceId: string): boolean {
  return RCCL_REQUIRED_SOURCES.includes(sourceId as RcclSourceId)
}

// ─── 统一 envelope ──────────────────────────────────────────────────────────

/** adapter 读取上下文：user/organization 由闭环 Service 经既有 Policy 解析后传入。 */
export interface RcclSourceReadContext {
  userId: number
  organizationId: number
  /** canonical 窗口起点/终点（YYYY-MM-DD，已对齐粒度）。 */
  windowStart: string
  windowEnd: string
  granularity: 'day' | 'week' | 'month'
}

export interface RcclSourceEnvelope<TData> {
  sourceId: RcclSourceId | string
  sourceVersion: string
  signature: string
  freshness: { generatedAt: string; stale: boolean }
  factState:
    | typeof RESOURCE_CAPACITY_LOOP_FACT_STATES.VISIBLE
    | typeof RESOURCE_CAPACITY_LOOP_FACT_STATES.REDACTED
    | typeof RESOURCE_CAPACITY_LOOP_FACT_STATES.MISSING
    | typeof RESOURCE_CAPACITY_LOOP_FACT_STATES.STALE
  warnings: ResourceCapacityLoopWarningCode[]
  truncated: boolean
  /** 有界数据载荷（各 adapter 自定形状，canonicalizer 只做投影）。 */
  data: TData
}

export type RcclSourceFailure = {
  sourceId: RcclSourceId | string
  required: boolean
  reasonCode:
    'RCCL_SOURCE_REQUIRED_FAILED' | 'RCCL_SOURCE_OPTIONAL_DEGRADED' | 'RCCL_BUDGET_EXCEEDED'
  message: string
}

export type RcclSourceOutcome<TData> =
  { ok: true; envelope: RcclSourceEnvelope<TData> } | { ok: false; failure: RcclSourceFailure }

export interface RcclSourceDefinition<TData> {
  sourceId: RcclSourceId | string
  read: (ctx: RcclSourceReadContext, signal: AbortSignal) => Promise<RcclSourceEnvelope<TData>>
}

export interface CollectOptions {
  /** 注入时钟基准（ISO），测试确定性用。 */
  now?: Date
  perSourceTimeoutMs?: number
  totalBudgetMs?: number
}

export interface CollectReport {
  startedAt: string
  finishedAt: string
  totalBudgetMs: number
  timedOutSourceIds: string[]
  budgetExhausted: boolean
}

export interface CollectResult {
  outcomes: Array<{ sourceId: string; required: boolean } & RcclSourceOutcome<unknown>>
  report: CollectReport
}

function failure(
  def: { sourceId: RcclSourceId | string },
  reasonCode: RcclSourceFailure['reasonCode'],
  message: string,
): RcclSourceOutcome<never> {
  return {
    ok: false,
    failure: {
      sourceId: def.sourceId,
      required: isRequiredSource(def.sourceId),
      reasonCode,
      message,
    },
  }
}

/**
 * 并发收集全部来源：
 * - 每来源独立超时（默认 10s）；
 * - 共享总预算截止线（默认 30s），超线后未启动的来源直接预算失败；
 * - 结果与输入顺序解耦——输出按定义数组顺序稳定排列。
 */
export async function collectSources<TDefs extends ReadonlyArray<RcclSourceDefinition<unknown>>>(
  defs: TDefs,
  ctx: RcclSourceReadContext,
  options: CollectOptions = {},
): Promise<CollectResult> {
  const perSourceTimeoutMs =
    options.perSourceTimeoutMs ?? RESOURCE_CAPACITY_LOOP_BUDGETS.SOURCE_TIMEOUT_MS
  const totalBudgetMs =
    options.totalBudgetMs ?? RESOURCE_CAPACITY_LOOP_BUDGETS.TOTAL_COLLECTION_BUDGET_MS
  const startedAt = (options.now ?? new Date()).toISOString()

  const controller = new AbortController()
  const budgetTimer = setTimeout(() => controller.abort(), totalBudgetMs)

  const settled = await Promise.all(
    defs.map(async (def): Promise<RcclSourceOutcome<unknown>> => {
      if (controller.signal.aborted) {
        return failure(def, 'RCCL_BUDGET_EXCEEDED', `总预算 ${totalBudgetMs}ms 已耗尽`)
      }
      try {
        const envelope = await withTimeout(def.read(ctx, controller.signal), perSourceTimeoutMs)
        return { ok: true, envelope }
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError' || /abort/i.test(err.message)) {
          return controller.signal.aborted
            ? failure(def, 'RCCL_BUDGET_EXCEEDED', '总预算耗尽取消')
            : failure(
                def,
                isRequiredSource(def.sourceId)
                  ? 'RCCL_SOURCE_REQUIRED_FAILED'
                  : 'RCCL_SOURCE_OPTIONAL_DEGRADED',
                '来源读取超时',
              )
        }
        return failure(
          def,
          isRequiredSource(def.sourceId)
            ? 'RCCL_SOURCE_REQUIRED_FAILED'
            : 'RCCL_SOURCE_OPTIONAL_DEGRADED',
          err.message || '来源读取失败',
        )
      }
    }),
  )

  clearTimeout(budgetTimer)
  const finishedAt = new Date().toISOString()
  const budgetExhausted =
    Date.parse(finishedAt) - Date.parse(startedAt) >= totalBudgetMs ||
    settled.some((s) => !s.ok && s.failure.reasonCode === 'RCCL_BUDGET_EXCEEDED')
  const timedOutSourceIds = settled
    .map((s, i) => ({ s, id: String(defs[i]!.sourceId) }))
    .filter(({ s }) => !s.ok && s.failure.message.includes('超时'))
    .map(({ id }) => id)

  // 稳定排序：按 defs 声明顺序即返回顺序（Promise.all 保序）。
  return {
    outcomes: settled.map((s, i) => ({
      ...s,
      sourceId: String(defs[i]!.sourceId),
      required: isRequiredSource(String(defs[i]!.sourceId)),
    })),
    report: { startedAt, finishedAt, totalBudgetMs, timedOutSourceIds, budgetExhausted },
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error(`来源读取超时（${ms}ms）`)
      err.name = 'AbortError'
      reject(err)
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}
