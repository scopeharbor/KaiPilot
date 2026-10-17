/**
 * v3-knowledge-memory-operating-layer —— four-layer knowledge read port。
 *
 * 设计 D2 / D8：
 * - 只读：list / get / count / resolveSurface。
 * - 调用既有 `KnowledgeService.query` / `getLowSensitiveById` 复用 L3 守卫与
 *   organization 隔离；不平行重造状态机。
 * - 不返回正文、prompt、token、secret；只返回低敏 projection。
 * - 任何失败都抛 `OperatingReadPortError`（closed code set）。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import KnowledgeService from '#services/knowledge/knowledge_service'
import type {
  KnowledgeItemLowSensitiveProjection,
  KnowledgeMemoryOperatingStatus,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryScopedRef,
  KnowledgeItemOperatingProjection,
  OperatingLowSensitiveEvidence,
  OperatingOwningSurfaceDescriptor,
} from '@aiproj/types'
import {
  computeSurfaceEnabled,
  buildOwningSurfaceDescriptor,
  deriveKnowledgeItemAttention,
  makeScopedRef,
  priorityForStatus,
  OPERATING_MAX_MERGE_WINDOW,
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
  type OperatingReadContext,
  OperatingReadPortError,
} from './port.js'
import {
  buildLaneCountResult,
  matchesOperatingFacets,
  takeOperatingWindow,
} from './projection_helpers.js'

// ── 工具：低敏 projection → operating item ──────────────────────────

interface ScopedRefParse {
  readonly id: number
}

function parseKnowledgeScopedRef(scopedRef: KnowledgeMemoryScopedRef): ScopedRefParse | null {
  // 形态：`k-<knowledgeItemId>`（opaque ref 不带 organizationId；跨租隔离由调用层 + db 强制）。
  const m = scopedRef.ref.match(/^k-(\d+)$/)
  if (!m) return null
  return { id: Number(m[1]) }
}

function formatKnowledgeScopedRef(id: number): KnowledgeMemoryScopedRef {
  return makeScopedRef('knowledge_item', `k-${id}`)
}

function buildKnowledgeItemOperating(
  projection: KnowledgeItemLowSensitiveProjection,
): KnowledgeItemOperatingProjection | null {
  // projection 是既有 KnowledgeService.getLowSensitiveById 的低敏产物
  // 真实字段：id / layer / title / status / domain / purpose / complexity? /
  // provenance(不含 reviewHistory) / isSynthetic / createdAt / updatedAt
  const layer = projection.layer as 'L1' | 'L2' | 'L3' | 'L4'
  const lifecycle = projection.status as 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
  const sourceCount = projection.provenance?.sources?.length ?? 0
  const hasProvenance = sourceCount > 0
  const isL3 = layer === 'L3' || projection.isSynthetic
  const status: KnowledgeMemoryOperatingStatus = deriveKnowledgeItemAttention({
    layer,
    lifecycle,
    hasProvenance,
    isL3EvalOnly: isL3,
  })
  const provenance: OperatingLowSensitiveEvidence[] = []
  if (sourceCount > 0) {
    for (const src of projection.provenance.sources.slice(0, 5)) {
      provenance.push({
        ref: `src-${src.layer}-${src.sourceId}`,
        sourceKind: layer === 'L1' ? 'standard' : layer === 'L2' ? 'project' : 'synthesized',
        status: 'available',
        fingerprint: src.isSynthetic ? `synth-${src.sourceId}` : undefined,
        observedAt: src.retrievedAt,
      })
    }
  }
  const safeLabels = [
    `layer:${layer}`,
    `lifecycle:${lifecycle}`,
    isL3 ? 'SYNTHETIC' : 'real',
    isL3 ? 'eval-only' : 'production-eligible',
  ]
  return {
    kind: 'knowledge_item',
    scopedRef: formatKnowledgeScopedRef(projection.id),
    scope: 'organization' as KnowledgeMemoryOperatingScope,
    visibility: 'visible',
    status,
    priority: priorityForStatus(status),
    freshnessState: lifecycle === 'outdated' ? 'stale' : 'fresh',
    title: projection.title,
    layer,
    lifecycle,
    provenance,
    reviewCount: 0,
    lastReviewedAt: undefined,
    attentionBasis: {
      reasonCode: status === 'ready' ? 'no_action_needed' : `${lifecycle}_attention`,
      basisRefs: [formatKnowledgeScopedRef(projection.id).ref],
      note: `layer=${layer};lifecycle=${lifecycle}`,
    },
    safeLabels,
    updatedAt: projection.updatedAt,
  }
}

// ── Port implementation ─────────────────────────────────────────────

@inject()
export default class KnowledgeOperatingReadPort {
  constructor(private readonly knowledge: KnowledgeService) {}

  readonly kind = 'knowledge_item' as const

  async countByFacets(input: OperatingCountInput): Promise<OperatingCountResult> {
    try {
      const scan = await this.#scanVisible(input.ctx)
      const visible = scan.items.filter((it) =>
        matchesOperatingFacets(it, { statuses: input.statuses }),
      )
      return buildLaneCountResult(visible, scan.truncated)
    } catch (err) {
      throw asPortError('knowledge_item', err, 'OPERATING_PORT_INTERNAL_ERROR')
    }
  }

  async listWindow(input: OperatingListInput): Promise<OperatingListResult> {
    const start = Date.now()
    try {
      const scan = await this.#scanVisible(input.ctx)
      const filtered = scan.items.filter((it) => {
        if (!matchesOperatingFacets(it, { statuses: input.statuses, scopes: input.scopes })) {
          return false
        }
        if (input.windowStartMs || input.windowEndMs) {
          const t = Date.parse(it.updatedAt)
          if (input.windowStartMs && t < input.windowStartMs) return false
          if (input.windowEndMs && t > input.windowEndMs) return false
        }
        return true
      })
      return {
        // 合并窗口：本 lane 稳定序的前 limit 项；跨 lane 切片由聚合器完成（D3）。
        items: takeOperatingWindow(filtered, input.limit),
        laneTotal: filtered.length,
        degraded: scan.truncated,
        queryMs: Date.now() - start,
        queryCount: 1, // 单次 query，无 N+1
      }
    } catch (err) {
      throw asPortError('knowledge_item', err, 'OPERATING_PORT_TIMEOUT')
    }
  }

  /**
   * 单次有界扫描（≤ `OPERATING_MAX_MERGE_WINDOW` 条低敏投影）。
   *
   * count 与 list 共用，保证 summary 与队列同一 visibility 规则。
   *
   * 走 `listLowSensitiveForGovernance` 而不是 `query()`：后者只返回 `active`
   * （它服务于「检索可用知识」），而治理队列的待办恰恰是 `pending` 与
   * `outdated`——用 `query()` 会让 needs_review 永远为空。L3 门禁在两条路径上
   * 是同一条红线，仍由 owning Service 执行。
   */
  async #scanVisible(
    ctx: OperatingReadContext,
  ): Promise<{ items: KnowledgeItemOperatingProjection[]; truncated: boolean }> {
    const rows = await this.knowledge.listLowSensitiveForGovernance(ctx.organizationId, {
      limit: OPERATING_MAX_MERGE_WINDOW,
      evalContext: ctx.evalContext ?? false,
    })
    const items: KnowledgeItemOperatingProjection[] = []
    for (const projection of rows) {
      const opItem = buildKnowledgeItemOperating(projection)
      if (opItem) items.push(opItem)
    }
    return { items, truncated: rows.length >= OPERATING_MAX_MERGE_WINDOW }
  }

  async getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null> {
    const ctx = input.ctx
    const parsed = parseKnowledgeScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const projection = await this.knowledge.getLowSensitiveById(ctx.organizationId, parsed.id)
      const opItem = buildKnowledgeItemOperating(projection)
      if (!opItem) return null
      const surfaces = buildKnowledgeSurfaces(opItem)
      return {
        item: opItem,
        surfaces,
        relatedCount: 0,
        fetchedAt: new Date().toISOString(),
      }
    } catch (err) {
      if (isNotFound(err)) return null
      throw asPortError('knowledge_item', err, 'OPERATING_PORT_INTERNAL_ERROR')
    }
  }

  async resolveSurface(
    input: OperatingResolveSurfaceInput,
  ): Promise<OperatingResolveSurfaceResult | null> {
    const ctx = input.ctx
    const parsed = parseKnowledgeScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const projection = await this.knowledge.getLowSensitiveById(ctx.organizationId, parsed.id)
      const opItem = buildKnowledgeItemOperating(projection)
      if (!opItem) return null
      const enabledCheck = computeSurfaceEnabled({
        surface: input.surface,
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: false,
        layer: opItem.layer,
        isMemoryScope: false,
      })
      if (!enabledCheck.enabled) {
        return null
      }
      const descriptor = buildOwningSurfaceDescriptor({
        surface: input.surface,
        scopedRef: opItem.scopedRef,
        enabled: true,
        routeKey: `/knowledge?layer=${opItem.layer}&status=${opItem.lifecycle}`,
        safeReturnContext: '知识审查',
      })
      return { descriptor }
    } catch (err) {
      if (isNotFound(err)) return null
      throw asPortError('knowledge_item', err, 'OPERATING_PORT_INTERNAL_ERROR')
    }
  }
}

// ── 内部 helper ─────────────────────────────────────────────────────

function buildKnowledgeSurfaces(
  opItem: KnowledgeItemOperatingProjection,
): readonly OperatingOwningSurfaceDescriptor[] {
  const enabledCheck = computeSurfaceEnabled({
    surface: 'knowledge_review',
    pluginDisabled: false,
    pluginUninstalled: false,
    baseStale: false,
    layer: opItem.layer,
    isMemoryScope: false,
  })
  if (!enabledCheck.enabled) return []
  return [
    buildOwningSurfaceDescriptor({
      surface: 'knowledge_review',
      scopedRef: opItem.scopedRef,
      enabled: true,
      routeKey: `/knowledge?layer=${opItem.layer}&status=${opItem.lifecycle}`,
      safeReturnContext: '知识审查',
    }),
  ]
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === 'KnowledgeItemNotFoundError' ||
    err.name === 'L3AccessDeniedError' ||
    err.message.includes('not found')
  )
}

function asPortError(
  port: import('@aiproj/types').KnowledgeMemoryOperatingKind,
  err: unknown,
  defaultCode: 'OPERATING_PORT_TIMEOUT' | 'OPERATING_PORT_INTERNAL_ERROR',
): OperatingReadPortError {
  if (err instanceof OperatingReadPortError) return err
  const code =
    err instanceof Error && err.message.includes('timeout') ? 'OPERATING_PORT_TIMEOUT' : defaultCode
  const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown'
  return new OperatingReadPortError(code, port, message)
}
