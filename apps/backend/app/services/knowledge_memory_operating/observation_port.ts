/**
 * v3-knowledge-memory-operating-layer —— retrieval observation read port。
 *
 * 设计 D7 / 3.9 / 3.10：
 * - 只读：从既有 `copilot_context_observations` 表按 source kind + window 聚合
 *   counts / ranges / coverage / degradation。
 * - 不存 individual query、不重放检索、不在 context assembly 路径加逻辑。
 * - 不把 zero-result 解释为「实体不存在」；permission-excluded 只计计数不记来源标识。
 *
 * **真实约束**（apply 阶段发现，已记入 observation-and-inventory §3.4）：
 * 既有 `CopilotContextObservationService` 只有 `recordObservation` 写接口，**没有**
 * 公共读接口。`retrievalQuality` JSON 列在生产上是空数组（service 注释
 * "由聚合层在查询时实时计算"），`queryCategory` 维度暂不可得——本 adapter
 * 使用 `unspecified` 占位，明确标注为设计 gap，跨 change 拉取时由另立
 * 修复 change 处理（不入本 change 范围）。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import CopilotContextObservation from '#models/copilot_context_observation'
import type {
  ContextObservationSourceRecord,
  ContextObservationTruncationRecord,
  ContextObservationUncertaintyRecord,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
  OperatingOwningSurfaceDescriptor,
  RetrievalSignalOperatingProjection,
} from '@aiproj/types'
import {
  buildOwningSurfaceDescriptor,
  computeSurfaceEnabled,
  deriveRetrievalSignalAttention,
  makeScopedRef,
  priorityForStatus,
} from '@aiproj/types'
import {
  type OperatingCountInput,
  type OperatingCountResult,
  type OperatingGetInput,
  type OperatingGetResult,
  type OperatingListInput,
  type OperatingListResult,
  type OperatingResolveSurfaceInput,
  type OperatingResolveSurfaceResult,
  OperatingReadPortError,
} from './port.js'
import {
  buildLaneCountResult,
  matchesOperatingFacets,
  takeOperatingWindow,
} from './projection_helpers.js'

/** 检索观测的固定聚合窗口：30 天（D7：固定时间窗，不由调用方任意扩大）。 */
const OBSERVATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 归一化 `observed_at` 为 ISO 串。
 *
 * 模型把该列声明成 `Date`，但用的是普通 `@column`（没有日期反序列化器），
 * 于是 Lucid 取回的其实是 SQLite 的原始字符串——直接 `.toISOString()` 会抛，
 * 整条观测 lane 因此恒为 degraded。这里同时接受 Date / string / number。
 */
function observedIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

// ── 聚合输出（per retrievalKind） ──────────────────────────────────

interface RetrievalKindAggregate {
  retrievalKind: string
  queryCategory: string
  sampleCount: number
  zeroResultCount: number
  aggregatedScoreMin: number
  aggregatedScoreMax: number
  truncatedCount: number
  degradedCount: number
  permissionExcludedCount: number
  uncertaintyHighCount: number
  windowStart: string
  windowEnd: string
}

async function aggregateObservations(
  ctx: { organizationId: number; actorId: number; projectId?: number | null },
  windowStartMs: number,
  windowEndMs: number,
): Promise<readonly RetrievalKindAggregate[]> {
  const base = CopilotContextObservation.query().where('organization_id', ctx.organizationId)
  if (ctx.projectId) {
    base.where((q: any) => {
      q.whereNull('project_id').orWhere('project_id', ctx.projectId)
    })
  }
  if (windowStartMs > 0 || windowEndMs > 0) {
    // 传 Date 而不是 ISO 字符串：`observed_at` 由驱动以 `YYYY-MM-DD HH:MM:SS.sss`
    // 落库，而 ISO 串在同一位置是 `T`。两者做字符串比较时空格 < 'T'，
    // 整个时间窗会一条都匹配不到——观测 lane 于是恒为空。
    base.whereBetween('observed_at', [new Date(windowStartMs), new Date(windowEndMs)])
  }
  const rows = await base.orderBy('observed_at', 'desc').limit(5000)
  const byKey = new Map<string, RetrievalKindAggregate>()
  for (const row of rows) {
    let sources: ContextObservationSourceRecord[] = []
    let truncation: ContextObservationTruncationRecord | null = null
    let uncertainty: ContextObservationUncertaintyRecord | null = null
    try {
      sources = JSON.parse(row.sources) as ContextObservationSourceRecord[]
    } catch {
      sources = []
    }
    try {
      truncation = JSON.parse(row.truncation) as ContextObservationTruncationRecord
    } catch {
      truncation = null
    }
    try {
      uncertainty = JSON.parse(row.uncertainty) as ContextObservationUncertaintyRecord
    } catch {
      uncertainty = null
    }
    for (const src of sources) {
      const key = src.retrievalKind
      let agg = byKey.get(key)
      if (!agg) {
        agg = {
          retrievalKind: key,
          queryCategory: 'unspecified',
          sampleCount: 0,
          zeroResultCount: 0,
          aggregatedScoreMin: src.scoreRange?.min ?? 0,
          aggregatedScoreMax: src.scoreRange?.max ?? 0,
          truncatedCount: 0,
          degradedCount: 0,
          permissionExcludedCount: 0,
          uncertaintyHighCount: 0,
          windowStart: observedIso(row.observedAt),
          windowEnd: observedIso(row.observedAt),
        }
        byKey.set(key, agg)
      }
      agg.sampleCount += src.hitCount
      if (src.hitCount === 0) agg.zeroResultCount += 1
      if (src.scoreRange) {
        if (src.scoreRange.min < agg.aggregatedScoreMin) {
          agg.aggregatedScoreMin = src.scoreRange.min
        }
        if (src.scoreRange.max > agg.aggregatedScoreMax) {
          agg.aggregatedScoreMax = src.scoreRange.max
        }
      }
      if (truncation?.truncated) agg.truncatedCount += 1
      if (row.degraded) agg.degradedCount += 1
      if (uncertainty?.notAccessibleCount) {
        agg.permissionExcludedCount += uncertainty.notAccessibleCount
      }
      if (uncertainty?.notExistsCount && uncertainty.notExistsCount > 5) {
        agg.uncertaintyHighCount += 1
      }
      if (Date.parse(observedIso(row.observedAt)) < Date.parse(agg.windowStart)) {
        agg.windowStart = observedIso(row.observedAt)
      }
      if (Date.parse(observedIso(row.observedAt)) > Date.parse(agg.windowEnd)) {
        agg.windowEnd = observedIso(row.observedAt)
      }
    }
  }
  return Array.from(byKey.values())
}

function buildRetrievalSignalOperating(
  agg: RetrievalKindAggregate,
  organizationId: number,
): RetrievalSignalOperatingProjection {
  const noObservation = agg.sampleCount === 0
  const zeroResultRate = agg.sampleCount > 0 ? agg.zeroResultCount / agg.sampleCount : 0
  const truncated = agg.truncatedCount > 0
  const uncertaintyHigh = agg.uncertaintyHighCount > 0
  const degraded = agg.degradedCount > 0
  const status: KnowledgeMemoryOperatingStatus = deriveRetrievalSignalAttention({
    degraded,
    noObservation,
    zeroResultRate,
    truncated,
    uncertaintyHigh,
    permissionExcludedCount: agg.permissionExcludedCount,
  })
  return {
    kind: 'retrieval_signal',
    scopedRef: makeScopedRef(
      'retrieval_signal',
      `r-${organizationId}-${encodeURIComponent(agg.retrievalKind)}`,
    ),
    scope: 'organization' as KnowledgeMemoryOperatingScope,
    visibility: noObservation ? 'empty' : degraded ? 'unavailable' : 'visible',
    status,
    priority: priorityForStatus(status),
    freshnessState: 'aging',
    retrievalKind: agg.retrievalKind,
    queryCategory: agg.queryCategory,
    windowStart: agg.windowStart,
    windowEnd: agg.windowEnd,
    sampleCount: agg.sampleCount,
    zeroResultRate,
    degraded,
    truncated,
    permissionExcludedCount: agg.permissionExcludedCount,
    attentionBasis: {
      reasonCode: degraded
        ? 'adapter_degraded'
        : noObservation
          ? 'no_observation'
          : zeroResultRate >= 0.5
            ? 'high_zero_result_rate'
            : 'normal',
      basisRefs: [`r-${organizationId}-${encodeURIComponent(agg.retrievalKind)}`],
      note: `kind=${agg.retrievalKind};category=${agg.queryCategory}`,
    },
    safeLabels: [`retrieval_kind:${agg.retrievalKind}`, `query_category:${agg.queryCategory}`],
    updatedAt: agg.windowEnd,
  }
}

@inject()
export default class RetrievalSignalOperatingReadPort {
  readonly kind = 'retrieval_signal' as const

  async countByFacets(input: OperatingCountInput): Promise<OperatingCountResult> {
    const ctx = input.ctx
    const endMs = Date.now()
    const startMs = endMs - OBSERVATION_WINDOW_MS
    try {
      const aggs = await aggregateObservations(ctx, startMs, endMs)
      const visible = aggs
        .map((a) => buildRetrievalSignalOperating(a, ctx.organizationId))
        .filter((it) => matchesOperatingFacets(it, { statuses: input.statuses }))
      return buildLaneCountResult(visible, false)
    } catch (err) {
      throw asPortError(err)
    }
  }

  async listWindow(input: OperatingListInput): Promise<OperatingListResult> {
    const ctx = input.ctx
    const start = Date.now()
    const endMs = input.windowEndMs ?? Date.now()
    const startMs = input.windowStartMs ?? endMs - OBSERVATION_WINDOW_MS
    try {
      const aggs = await aggregateObservations(ctx, startMs, endMs)
      const filtered = aggs
        .map((a) => buildRetrievalSignalOperating(a, ctx.organizationId))
        .filter((it) =>
          matchesOperatingFacets(it, { statuses: input.statuses, scopes: input.scopes }),
        )
      // 单次 aggregation query（带 join 到 sources/truncation/uncertainty JSON 列）；
      // 每条 row 仅一次 JSON.parse，无 N+1。信号按 source kind 聚合，条数被
      // 词表大小天然限定，不会触及合并窗口上限。
      return {
        items: takeOperatingWindow(filtered, input.limit),
        laneTotal: filtered.length,
        degraded: false,
        queryMs: Date.now() - start,
        queryCount: 1,
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  async getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null> {
    const ctx = input.ctx
    const m = input.scopedRef.ref.match(/^r-(\d+)-(.+)$/)
    if (!m) return null
    const kind = decodeURIComponent(m[2]!)
    try {
      const endMs = Date.now()
      const startMs = endMs - OBSERVATION_WINDOW_MS
      const aggs = await aggregateObservations(ctx, startMs, endMs)
      const match = aggs.find((a) => a.retrievalKind === kind)
      if (!match) return null
      const opItem = buildRetrievalSignalOperating(match, ctx.organizationId)
      return {
        item: opItem,
        surfaces: this.#buildSurfaces(opItem),
        relatedCount: 0,
        fetchedAt: new Date().toISOString(),
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  async resolveSurface(
    input: OperatingResolveSurfaceInput,
  ): Promise<OperatingResolveSurfaceResult | null> {
    const ctx = input.ctx
    const m = input.scopedRef.ref.match(/^r-(\d+)-(.+)$/)
    if (!m) return null
    const kind = decodeURIComponent(m[2]!)
    try {
      const endMs = Date.now()
      const startMs = endMs - OBSERVATION_WINDOW_MS
      const aggs = await aggregateObservations(ctx, startMs, endMs)
      const match = aggs.find((a) => a.retrievalKind === kind)
      if (!match) return null
      const opItem = buildRetrievalSignalOperating(match, ctx.organizationId)
      const enabled = computeSurfaceEnabled({
        surface: input.surface,
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: false,
        isMemoryScope: false,
      })
      if (!enabled.enabled) return null
      return {
        descriptor: buildOwningSurfaceDescriptor({
          surface: input.surface,
          scopedRef: opItem.scopedRef,
          enabled: true,
          routeKey: '/copilot/observations',
          safeReturnContext: '检索观测详情',
        }),
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  #buildSurfaces(
    opItem: RetrievalSignalOperatingProjection,
  ): readonly OperatingOwningSurfaceDescriptor[] {
    return [
      buildOwningSurfaceDescriptor({
        surface: 'retrieval_observation_detail',
        scopedRef: opItem.scopedRef,
        enabled: true,
        routeKey: '/copilot/observations',
        safeReturnContext: '检索观测详情',
      }),
    ]
  }
}

function asPortError(err: unknown): OperatingReadPortError {
  if (err instanceof OperatingReadPortError) return err
  const code =
    err instanceof Error && err.message.includes('timeout')
      ? 'OPERATING_PORT_TIMEOUT'
      : 'OPERATING_PORT_INTERNAL_ERROR'
  const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown'
  return new OperatingReadPortError(code, 'retrieval_signal', message)
}
