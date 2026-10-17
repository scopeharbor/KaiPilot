/**
 * v3-knowledge-memory-operating-layer —— Copilot memory read port。
 *
 * 设计 D2 / 3.5 / 3.6：
 * - 只读：list / get / count / resolveSurface。
 * - 通过 `CopilotMemoryEntry` Lucid Model + 既有 static scopes 复用组织隔离
 *   与 actor/project/scope 过滤；不平行重造 service。
 * - 严格不返回 memory summary 内容（spec: "绝不返回 summary 内容"）。
 *   只返回 summary byte size + basis count + status + confidenceSource + conflict 标。
 * - 失败 closed：抛 OperatingReadPortError（closed code set）。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import type {
  CopilotMemoryOperatingProjection,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
  KnowledgeMemoryScopedRef,
  OperatingOwningSurfaceDescriptor,
} from '@aiproj/types'
import {
  buildOwningSurfaceDescriptor,
  computeSurfaceEnabled,
  deriveCopilotMemoryAttention,
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
  type OperatingReadContext,
  type OperatingResolveSurfaceInput,
  type OperatingResolveSurfaceResult,
  OperatingReadPortError,
} from './port.js'
import { countByStatus, matchesOperatingFacets, takeOperatingWindow } from './projection_helpers.js'

// ── ScopedRef ────────────────────────────────────────────────────────

interface ScopedRefParse {
  readonly id: number
}

function parseMemoryScopedRef(ref: KnowledgeMemoryScopedRef): ScopedRefParse | null {
  const m = ref.ref.match(/^m-(\d+)$/)
  if (!m) return null
  return { id: Number(m[1]) }
}

function formatMemoryScopedRef(id: number): KnowledgeMemoryScopedRef {
  return makeScopedRef('copilot_memory', `m-${id}`)
}

// ── Projection builder ──────────────────────────────────────────────

function buildMemoryOperating(
  entry: CopilotMemoryEntry,
  ctx: { organizationId: number; actorId: number; projectId?: number | null },
): CopilotMemoryOperatingProjection {
  const statusDetail = entry.status
  const memoryScope = entry.memoryScope
  // 跨租访问控制：本 actor 不可读取他人 user memory。
  const isOwnUserMemory = memoryScope === 'user' && entry.actorId === ctx.actorId
  const isProjectMemory = memoryScope === 'project' && ctx.projectId === entry.projectId
  // visibility 推断：
  // - user memory：仅 actor 本人 + org 审计
  // - project memory：仅项目内可见
  // - organization memory：org 内默认可见
  let visibility: 'visible' | 'hidden' | 'unavailable' = 'visible'
  if (memoryScope === 'user' && !isOwnUserMemory) visibility = 'hidden'
  if (memoryScope === 'project' && !isProjectMemory) visibility = 'hidden'

  // live fact conflict 由 detectConflictWithLiveFact 派生（copilot_memory_injector）
  // 默认不可得；本 adapter 标注为 false，由 owning service 后续以另一种 surface
  // 提示冲突。本字段留作 spec 预留。
  const hasLiveFactConflict = false

  // long_unconfirmed：用 statusDetail==='candidate' || validityTier==='durable' && updated > 90d
  // 简化为：candidate 状态永远 long_unconfirmed
  const longUnconfirmed = statusDetail === 'candidate'

  const status: KnowledgeMemoryOperatingStatus = deriveCopilotMemoryAttention({
    statusDetail: statusDetail as
      'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated',
    hasLiveFactConflict,
    longUnconfirmed,
  })
  const basis = entry.basis ?? []
  const summaryByteSize = entry.summary ? entry.summary.length : 0
  const safeLabels = ['inference', `memory_scope:${memoryScope}`]
  return {
    kind: 'copilot_memory',
    scopedRef: formatMemoryScopedRef(entry.id),
    owningEntryRef: entry.entryId,
    scope: (memoryScope === 'organization'
      ? 'organization'
      : memoryScope === 'project'
        ? 'project'
        : 'user') as KnowledgeMemoryOperatingScope,
    memoryScope,
    visibility,
    status,
    priority: priorityForStatus(status),
    freshnessState:
      statusDetail === 'possibly_outdated' || longUnconfirmed
        ? 'aging'
        : statusDetail === 'invalidated'
          ? 'stale'
          : 'fresh',
    summaryByteSize,
    basisCount: basis.length,
    confidenceSource: entry.confidenceSource,
    statusDetail,
    hasLiveFactConflict,
    attentionBasis: {
      reasonCode: hasLiveFactConflict
        ? 'live_fact_conflict'
        : (statusDetail as string) === 'candidate'
          ? 'awaiting_review'
          : longUnconfirmed
            ? 'long_unconfirmed'
            : 'inference_anchor',
      basisRefs: [formatMemoryScopedRef(entry.id).ref],
      note: `scope=${memoryScope};status=${statusDetail}`,
    },
    safeLabels,
    updatedAt: (entry.updatedAt ?? entry.observedAt ?? new Date(0)).toISO() as string,
  }
}

// ── Port implementation ─────────────────────────────────────────────

@inject()
export default class CopilotMemoryOperatingReadPort {
  readonly kind = 'copilot_memory' as const

  async countByFacets(input: OperatingCountInput): Promise<OperatingCountResult> {
    try {
      const scan = await this.#scanVisible(input.ctx)
      const visible = scan.items.filter((it) =>
        matchesOperatingFacets(it, { statuses: input.statuses }),
      )
      return {
        total: visible.length,
        attentionCount: visible.filter((it) => it.status !== 'ready').length,
        statusCounts: countByStatus(visible),
        degraded: scan.truncated,
        coverage: scan.truncated ? 'partial' : visible.length === 0 ? 'empty' : 'complete',
      }
    } catch (err) {
      throw asPortError('copilot_memory', err)
    }
  }

  async listWindow(input: OperatingListInput): Promise<OperatingListResult> {
    const start = Date.now()
    try {
      const scan = await this.#scanVisible(input.ctx)
      const filtered = scan.items.filter((it) =>
        matchesOperatingFacets(it, { statuses: input.statuses, scopes: input.scopes }),
      )
      return {
        // 合并窗口：本 lane 稳定序的前 limit 项。不做 offset——跨 lane 切片
        // 由聚合器在合并后统一完成（D3）。
        items: takeOperatingWindow(filtered, input.limit),
        laneTotal: filtered.length,
        degraded: scan.truncated,
        queryMs: Date.now() - start,
        queryCount: 1,
      }
    } catch (err) {
      throw asPortError('copilot_memory', err)
    }
  }

  /**
   * 单次有界扫描（≤ `OPERATING_MAX_MERGE_WINDOW` 行）。
   *
   * attention status 与 visibility 都由行字段在内存派生，无法下推成 SQL
   * predicate，所以 count 与 list **共用本方法**——这正是 spec 要求的
   * 「summary 与队列使用同一 visibility 规则」。窗口触顶时如实返回
   * `truncated`，由调用方降级为 partial coverage，绝不把截断数字当完整总数。
   */
  async #scanVisible(
    ctx: OperatingReadContext,
  ): Promise<{ items: CopilotMemoryOperatingProjection[]; truncated: boolean }> {
    const rows = await this.#scopedQuery(ctx)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(OPERATING_MAX_MERGE_WINDOW)
    return {
      items: rows
        .map((r) => buildMemoryOperating(r, ctx))
        .filter((it) => it.visibility === 'visible'),
      truncated: rows.length >= OPERATING_MAX_MERGE_WINDOW,
    }
  }

  async getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null> {
    const ctx = input.ctx
    const parsed = parseMemoryScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const entry = await this.#scopedQuery(ctx).where('id', parsed.id).first()
      if (!entry) return null
      const opItem = buildMemoryOperating(entry, ctx)
      if (opItem.visibility === 'hidden') return null
      const surfaces = this.#buildSurfaces(opItem)
      return {
        item: opItem,
        surfaces,
        relatedCount: 0,
        fetchedAt: new Date().toISOString(),
      }
    } catch (err) {
      throw asPortError('copilot_memory', err)
    }
  }

  async resolveSurface(
    input: OperatingResolveSurfaceInput,
  ): Promise<OperatingResolveSurfaceResult | null> {
    const ctx = input.ctx
    const parsed = parseMemoryScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const entry = await this.#scopedQuery(ctx).where('id', parsed.id).first()
      if (!entry) return null
      const opItem = buildMemoryOperating(entry, ctx)
      if (opItem.visibility === 'hidden') return null
      const enabled = computeSurfaceEnabled({
        surface: input.surface,
        pluginDisabled: false,
        pluginUninstalled: false,
        baseStale: false,
        isMemoryScope: true,
      })
      if (!enabled.enabled) return null
      return {
        descriptor: buildOwningSurfaceDescriptor({
          surface: input.surface,
          scopedRef: opItem.scopedRef,
          enabled: true,
          routeKey: '/copilot/memory?tab=governance',
          safeReturnContext: 'Copilot 记忆治理',
        }),
      }
    } catch (err) {
      throw asPortError('copilot_memory', err)
    }
  }

  // ── 内部：构造 query builder（统一组织 + actor + project + scope 隔离） ──

  #scopedQuery(ctx: { organizationId: number; actorId: number; projectId?: number | null }) {
    const q = CopilotMemoryEntry.query().where('organization_id', ctx.organizationId)
    if (ctx.projectId) {
      q.where((b: any) => {
        b.where('memory_scope', 'organization')
          .orWhere((q2: any) => {
            q2.where('memory_scope', 'project').where('project_id', ctx.projectId)
          })
          .orWhere((q3: any) => {
            q3.where('memory_scope', 'user').where('actor_id', ctx.actorId)
          })
      })
    } else {
      q.where((b: any) => {
        b.where('memory_scope', 'organization')
          .orWhere((q2: any) => {
            q2.where('memory_scope', 'user').where('actor_id', ctx.actorId)
          })
          .orWhere('memory_scope', 'project')
      })
    }
    return q
  }

  #buildSurfaces(
    opItem: CopilotMemoryOperatingProjection,
  ): readonly OperatingOwningSurfaceDescriptor[] {
    const enabled = computeSurfaceEnabled({
      surface: 'copilot_memory_governance',
      pluginDisabled: false,
      pluginUninstalled: false,
      baseStale: false,
      isMemoryScope: true,
    })
    if (!enabled.enabled) return []
    return [
      buildOwningSurfaceDescriptor({
        surface: 'copilot_memory_governance',
        scopedRef: opItem.scopedRef,
        enabled: true,
        routeKey: '/copilot/memory?tab=governance',
        safeReturnContext: 'Copilot 记忆治理',
      }),
    ]
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function asPortError(port: 'copilot_memory', err: unknown): OperatingReadPortError {
  if (err instanceof OperatingReadPortError) return err
  const code =
    err instanceof Error && err.message.includes('timeout')
      ? 'OPERATING_PORT_TIMEOUT'
      : 'OPERATING_PORT_INTERNAL_ERROR'
  const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown'
  return new OperatingReadPortError(code, port, message)
}
