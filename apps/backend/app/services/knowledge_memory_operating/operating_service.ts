/**
 * v3-knowledge-memory-operating-layer —— Operating 聚合 Service。
 *
 * 设计 D2 / D3 / D5 / §4.3-4.10：
 * - 4 read port 入口编排；先 tenant/Policy（controller 注入），
 *   再并行调用有权 kind 的 listWindow / getProjection / resolveSurface。
 * - getSummary：4 lane 并行 countByFacets，按 status 聚合 + coverage + 0 写入。
 * - listItems：多 lane bounded merge + stable sort + meta（含 degraded lanes）。
 * - getItemDetail：按 kind+scopedRef 重新解析 visibility 与 current state，
 *   隐藏对象 → 返回 null（controller 映射 404）。
 * - resolveSurface：服务端权威 enabled 判定（client 不可伪造，§4.9）。
 * - **零模型写入**；**零网络外发**；**零 AI 调用**（§4.18 read-only zero-diff）。
 *
 * 失败按 lane 隔离（D9）：单 lane 失败只标该 lane degraded，整体仍返回；
 * core failure → fail closed 抛 OperatingServiceError。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import {
  type KnowledgeItemOperatingProjection,
  type CopilotMemoryOperatingProjection,
  type SkillKnowledgeDraftOperatingProjection,
  type RetrievalSignalOperatingProjection,
  type KnowledgeMemoryOperatingItem,
  type KnowledgeMemoryOperatingKind,
  type KnowledgeMemoryOperatingStatus,
  type KnowledgeMemoryOperatingSurface,
  type KnowledgeMemoryScopedRef,
  type OperatingLaneCount,
  type OperatingListEnvelope,
  type OperatingListFilters,
  type OperatingListMeta,
  type OperatingOwningSurfaceDescriptor,
  type OperatingSummary,
  type KnowledgeMemoryOperatingScope,
  priorityForStatus,
} from '@aiproj/types'
import {
  buildOperatingListEnvelope,
  computeOperatingSortKey,
  compareOperatingSortKeys,
  scanOperatingLowSensitive,
  scanOperatingItemsAllowlist,
  scanOperatingItemAllowlist,
  operatingMergeWindowFor,
  isOperatingPageWithinMergeWindow,
} from '@aiproj/types'
import {
  type KnowledgeOperatingReadPort,
  type CopilotMemoryOperatingReadPort,
  type SkillKnowledgeDraftOperatingReadPort,
  type RetrievalSignalOperatingReadPort,
  type OperatingReadContext,
  type OperatingCountResult,
  type OperatingReadPortRegistry,
  OperatingReadPortError,
  isReadPortKind,
} from './port.js'
import KnowledgeOperatingReadPortImpl from './knowledge_port.js'
import CopilotMemoryOperatingReadPortImpl from './memory_port.js'
import SkillKnowledgeDraftOperatingReadPortImpl from './skill_draft_port.js'
import RetrievalSignalOperatingReadPortImpl from './observation_port.js'

/**
 * 单个 lane 的有界超时（毫秒）。
 *
 * 本机 SQLite 上的有界扫描远低于该值；设这个上限是为了让某个 lane 卡住时
 * 其余 lane 仍能按时返回，而不是把整页拖成超时。
 */
export const OPERATING_LANE_TIMEOUT_MS = 5_000

/** Operating 业务错误（与 OperatingReadPortError 区分；端口错 vs 业务错）。 */
export class OperatingServiceError extends Error {
  constructor(
    public readonly code:
      | 'OPERATING_SERVICE_DENIED'
      | 'OPERATING_SERVICE_INTERNAL'
      | 'OPERATING_SERVICE_PAGE_OUT_OF_RANGE',
    message: string,
  ) {
    super(`[${code}] ${message}`)
    this.name = 'OperatingServiceError'
  }
}

@inject()
export default class KnowledgeMemoryOperatingService {
  /**
   * 四个 read port 以具体类注入（AdonisJS 容器按 design:paramtypes 解析）。
   * 匿名对象类型无法被容器解析，因此不能把 registry 当作单一构造参数。
   * 单元测试用 `KnowledgeMemoryOperatingService.withPorts(registry)` 注入替身。
   */
  constructor(
    knowledgePort: KnowledgeOperatingReadPortImpl,
    memoryPort: CopilotMemoryOperatingReadPortImpl,
    skillDraftPort: SkillKnowledgeDraftOperatingReadPortImpl,
    retrievalPort: RetrievalSignalOperatingReadPortImpl,
  ) {
    this.deps = {
      knowledge: knowledgePort,
      memory: memoryPort,
      skillDraft: skillDraftPort,
      retrieval: retrievalPort,
    }
  }

  private deps: OperatingReadPortRegistry

  /**
   * 测试专用：以任意（含 mock）port registry 构造聚合器，不经容器。
   *
   * 聚合器只按 port **接口**调用；具体类的私有成员使这些实现类在类型上
   * 名义不兼容，所以这里显式放宽——运行时只用到接口方法。
   */
  static withPorts(registry: OperatingReadPortRegistry): KnowledgeMemoryOperatingService {
    return new KnowledgeMemoryOperatingService(
      registry.knowledge as unknown as KnowledgeOperatingReadPortImpl,
      registry.memory as unknown as CopilotMemoryOperatingReadPortImpl,
      registry.skillDraft as unknown as SkillKnowledgeDraftOperatingReadPortImpl,
      registry.retrieval as unknown as RetrievalSignalOperatingReadPortImpl,
    )
  }

  /**
   * §4.3 getSummary：四 lane count + facet counts + coverage。
   * 失败按 lane 隔离（partial/degraded），整体不抛。
   */
  async getSummary(ctx: OperatingReadContext): Promise<OperatingSummary> {
    const [kCount, mCount, sCount, rCount] = await Promise.all([
      this.#safeCount(this.deps.knowledge, ctx),
      this.#safeCount(this.deps.memory, ctx),
      this.#safeCount(this.deps.skillDraft, ctx),
      this.#safeCount(this.deps.retrieval, ctx),
    ])

    const laneResults: Array<{ kind: KnowledgeMemoryOperatingKind; count: LaneCountInternal }> = [
      { kind: this.deps.knowledge.kind, count: kCount },
      { kind: this.deps.memory.kind, count: mCount },
      { kind: this.deps.skillDraft.kind, count: sCount },
      { kind: this.deps.retrieval.kind, count: rCount },
    ]

    const lanes: OperatingLaneCount[] = laneResults.map((r) => laneCount(r.kind, r.count))

    const attentionFacetCounts: Record<KnowledgeMemoryOperatingStatus, number> = {
      ready: 0,
      needs_review: 0,
      stale_or_unconfirmed: 0,
      conflict: 0,
      provenance_gap: 0,
      synthetic_eval_only: 0,
      retention_attention: 0,
      retrieval_gap: 0,
      degraded: 0,
    }
    for (const { count } of laneResults) {
      for (const status of Object.keys(attentionFacetCounts) as KnowledgeMemoryOperatingStatus[]) {
        attentionFacetCounts[status] += count.statusCounts[status]
      }
    }
    const totalAttention = lanes.reduce((s, l) => s + l.attentionCount, 0)
    return {
      organizationId: ctx.organizationId,
      generatedAt: new Date().toISOString(),
      lanes,
      attentionFacetCounts,
      totalAttention,
      anyLaneDegraded: lanes.some((l) => l.degraded),
      visibility: 'visible',
    }
  }

  /**
   * §4.5 listItems：bounded multi-lane merge + stable sort + meta。
   * 失败按 lane 隔离（单 lane 失败标 degraded，整体返回空 envelope）。
   */
  async listItems(
    ctx: OperatingReadContext,
    filters: OperatingListFilters,
  ): Promise<OperatingListEnvelope> {
    // 深页超出合并窗口时必须显式拒绝：静默返回空页会被读成「没有更多对象」，
    // 正是 spec 禁止的 false-zero。
    if (!isOperatingPageWithinMergeWindow(filters.page, filters.perPage)) {
      throw new OperatingServiceError(
        'OPERATING_SERVICE_PAGE_OUT_OF_RANGE',
        `page ${filters.page} x perPage ${filters.perPage} 超出合并窗口上限`,
      )
    }
    // 选 lane
    const requestedKinds =
      filters.kinds && filters.kinds.length > 0
        ? new Set(filters.kinds)
        : new Set<KnowledgeMemoryOperatingKind>([
            'knowledge_item',
            'copilot_memory',
            'skill_knowledge_draft',
            'retrieval_signal',
          ])
    const lanes: Record<KnowledgeMemoryOperatingKind, readonly KnowledgeMemoryOperatingItem[]> = {
      knowledge_item: [],
      copilot_memory: [],
      skill_knowledge_draft: [],
      retrieval_signal: [],
    }
    const degradedLanes: KnowledgeMemoryOperatingKind[] = []
    const portResults = await Promise.all([
      requestedKinds.has(this.deps.knowledge.kind)
        ? this.#safeList(this.deps.knowledge, ctx, filters)
        : Promise.resolve({
            items: [] as readonly KnowledgeMemoryOperatingItem[],
            laneTotal: 0,
            degraded: false,
          } as const),
      requestedKinds.has(this.deps.memory.kind)
        ? this.#safeList(this.deps.memory, ctx, filters)
        : Promise.resolve({
            items: [] as readonly KnowledgeMemoryOperatingItem[],
            laneTotal: 0,
            degraded: false,
          } as const),
      requestedKinds.has(this.deps.skillDraft.kind)
        ? this.#safeList(this.deps.skillDraft, ctx, filters)
        : Promise.resolve({
            items: [] as readonly KnowledgeMemoryOperatingItem[],
            laneTotal: 0,
            degraded: false,
          } as const),
      requestedKinds.has(this.deps.retrieval.kind)
        ? this.#safeList(this.deps.retrieval, ctx, filters)
        : Promise.resolve({
            items: [] as readonly KnowledgeMemoryOperatingItem[],
            laneTotal: 0,
            degraded: false,
          } as const),
    ])
    const laneTotals: Partial<Record<KnowledgeMemoryOperatingKind, number>> = {}
    const ordered = [
      this.deps.knowledge.kind,
      this.deps.memory.kind,
      this.deps.skillDraft.kind,
      this.deps.retrieval.kind,
    ] as const
    ordered.forEach((kind, i) => {
      const res = portResults[i]!
      lanes[kind] = res.items
      laneTotals[kind] = res.laneTotal
      if (res.degraded) degradedLanes.push(kind)
    })
    return buildOperatingListEnvelope(
      lanes as Readonly<
        Record<KnowledgeMemoryOperatingKind, readonly KnowledgeMemoryOperatingItem[]>
      >,
      filters,
      degradedLanes,
      laneTotals,
    )
  }

  /**
   * §4.7 getItemDetail：按 kind+scopedRef 重新解析 visibility / current state。
   * 隐藏 / 跨租 / 不可用 → null（controller 映射 404）。
   * 必须用 port.getProjection，不得绕过 port 直接查 model。
   */
  async getItemDetail(
    ctx: OperatingReadContext,
    scopedRef: KnowledgeMemoryScopedRef,
  ): Promise<{
    item: KnowledgeMemoryOperatingItem
    surfaces: readonly OperatingOwningSurfaceDescriptor[]
    relatedCount: number
    fetchedAt: string
  } | null> {
    if (!isReadPortKind(scopedRef.kind)) return null
    const port = this.#portForKind(scopedRef.kind)
    if (!port) return null
    const result = await port.getProjection({ ctx, scopedRef })
    if (!result) return null
    // 低敏 allowlist 二次扫描：端口应已过滤；这里再扫一道 fail-closed
    const allowlist = scanOperatingItemAllowlist(result.item)
    const scan = scanOperatingLowSensitive({
      item: result.item,
      surfaces: result.surfaces,
    })
    if (!allowlist.safe || !scan.safe) {
      throw new OperatingServiceError(
        'OPERATING_SERVICE_INTERNAL',
        `low_sensitive_violation:${[...allowlist.hits, ...scan.hits].slice(0, 3).join(',')}`,
      )
    }
    return {
      item: result.item,
      surfaces: result.surfaces,
      relatedCount: result.relatedCount,
      fetchedAt: result.fetchedAt,
    }
  }

  /**
   * §4.9 resolveSurface：服务端权威 enabled 判定（client 不可伪造）。
   * 不可用 / 禁用 / 隐藏 / 跨租 → null。
   */
  async resolveSurface(
    ctx: OperatingReadContext,
    scopedRef: KnowledgeMemoryScopedRef,
    surface: KnowledgeMemoryOperatingSurface,
  ): Promise<OperatingOwningSurfaceDescriptor | null> {
    if (!isReadPortKind(scopedRef.kind)) return null
    const port = this.#portForKind(scopedRef.kind)
    if (!port) return null
    const result = await port.resolveSurface({ ctx, scopedRef, surface })
    if (!result) return null
    return result.descriptor
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  #portForKind(kind: KnowledgeMemoryOperatingKind) {
    switch (kind) {
      case 'knowledge_item':
        return this.deps.knowledge
      case 'copilot_memory':
        return this.deps.memory
      case 'skill_knowledge_draft':
        return this.deps.skillDraft
      case 'retrieval_signal':
        return this.deps.retrieval
    }
  }

  /**
   * 每 lane 的有界超时（D9）。
   *
   * 超时后**不自动重试、不回落到任何 provider**——运营层是只读投影面，
   * 重试只会把一次慢查询放大成四次；由客户端对该 lane 显式重试。
   * 超时以 port 的 closed 错误码抛出，由调用方降级为该 lane 的 degraded。
   */
  async #withLaneTimeout<T>(kind: KnowledgeMemoryOperatingKind, run: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new OperatingReadPortError(
                'OPERATING_PORT_TIMEOUT',
                kind,
                `lane 超过 ${OPERATING_LANE_TIMEOUT_MS}ms 未返回`,
              ),
            )
          }, OPERATING_LANE_TIMEOUT_MS)
          // 定时器不应把进程留活（测试与 CLI 场景）
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async #safeCount(
    port:
      | KnowledgeOperatingReadPort
      | CopilotMemoryOperatingReadPort
      | SkillKnowledgeDraftOperatingReadPort
      | RetrievalSignalOperatingReadPort,
    ctx: OperatingReadContext,
  ) {
    try {
      // 不带 status 过滤：summary 必须与「未筛选的队列」看到同一批对象，
      // 否则 lane total 会漏掉 ready 项、facet 表里的 ready 恒为 0，
      // 读起来就像组织里没有已就绪的内容。attentionCount 另行排除 ready。
      return await this.#withLaneTimeout(port.kind, () => port.countByFacets({ ctx }))
    } catch (err) {
      if (err instanceof OperatingReadPortError) {
        return {
          total: 0,
          attentionCount: 0,
          statusCounts: zeroStatusCounts(),
          degraded: true,
          coverage: 'degraded' as const,
        }
      }
      throw new OperatingServiceError(
        'OPERATING_SERVICE_INTERNAL',
        `count_failed:${port.kind}:${(err as Error).message?.slice(0, 120) ?? 'unknown'}`,
      )
    }
  }

  async #safeList(
    port:
      | KnowledgeOperatingReadPort
      | CopilotMemoryOperatingReadPort
      | SkillKnowledgeDraftOperatingReadPort
      | RetrievalSignalOperatingReadPort,
    ctx: OperatingReadContext,
    filters: OperatingListFilters,
  ) {
    try {
      const res = await this.#withLaneTimeout(port.kind, () =>
        port.listWindow({
          ctx,
          statuses: filters.statuses,
          scopes: filters.scopes,
          // 每个 lane 交出合并窗口内的前 N 项；跨 lane 的 offset 切片在合并后
          // 统一完成——让 lane 各自翻页会导致相邻页重复与遗漏（D3）。
          limit: operatingMergeWindowFor(filters.page, filters.perPage),
        }),
      )
      // adapter 输出校验：先按 kind 的字段 **allowlist** 拒绝未声明 key，
      // 再扫一遍诱饵串。违规内容必须在进入聚合器之前被拦下，而不是穿透到
      // 响应里，所以整条 lane 降级、不悄悄放行。
      const allowlist = scanOperatingItemsAllowlist(res.items)
      const bait = scanOperatingLowSensitive({ items: res.items })
      if (!allowlist.safe || !bait.safe) {
        return { items: [], laneTotal: 0, degraded: true }
      }
      return { items: res.items, laneTotal: res.laneTotal, degraded: res.degraded }
    } catch (err) {
      if (err instanceof OperatingReadPortError) {
        // lane 失败只降级该 lane：总数用 0 会把降级读成「这类没有内容」，
        // 因此 degraded 标必须随行传给 UI（D9 / spec 禁止 false-zero）。
        return { items: [], laneTotal: 0, degraded: true }
      }
      throw new OperatingServiceError(
        'OPERATING_SERVICE_INTERNAL',
        `list_failed:${port.kind}:${(err as Error).message?.slice(0, 120) ?? 'unknown'}`,
      )
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────

type LaneCountInternal = OperatingCountResult

function laneCount(
  kind: KnowledgeMemoryOperatingKind,
  count: LaneCountInternal,
): OperatingLaneCount {
  return {
    lane: kind,
    total: count.total,
    attentionCount: count.attentionCount,
    degraded: count.degraded,
    coverage: count.coverage,
  }
}

function zeroStatusCounts(): Record<KnowledgeMemoryOperatingStatus, number> {
  return {
    ready: 0,
    needs_review: 0,
    stale_or_unconfirmed: 0,
    conflict: 0,
    provenance_gap: 0,
    synthetic_eval_only: 0,
    retention_attention: 0,
    retrieval_gap: 0,
    degraded: 0,
  }
}

// Re-exports for type narrowing in tests.
export type {
  KnowledgeItemOperatingProjection,
  CopilotMemoryOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
  RetrievalSignalOperatingProjection,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryScopedRef,
  OperatingListEnvelope,
  OperatingListMeta,
  OperatingListFilters,
  OperatingSummary,
  OperatingOwningSurfaceDescriptor,
  OperatingReadContext,
  OperatingReadPortError,
  KnowledgeOperatingReadPort,
  CopilotMemoryOperatingReadPort,
  SkillKnowledgeDraftOperatingReadPort,
  RetrievalSignalOperatingReadPort,
  KnowledgeMemoryOperatingSurface,
}
export {
  buildOperatingListEnvelope,
  computeOperatingSortKey,
  compareOperatingSortKeys,
  priorityForStatus,
}
