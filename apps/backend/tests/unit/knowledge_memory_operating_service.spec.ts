/**
 * v3-knowledge-memory-operating-layer —— 聚合 Service 单元测试（vitest 风格）。
 *
 * 覆盖：
 * - 4.4  summary 四 kind counts / facet counts / partial-degraded coverage /
 *        禁止 false-zero（lane 失败不得计为 0 且不得报 ready）
 * - 4.6  同输入确定性、相邻页无重复遗漏、非法深页拒绝、单 lane failure 隔离、
 *        total/totalPages 一致
 * - 4.10 四 owning surface 的 allow/deny、authority owner、无 callback/handle
 * - 4.9  服务端 surface resolve：客户端伪造的 enabled 不被采信
 *
 * 用 in-memory 假 port（`KnowledgeMemoryOperatingService.withPorts`）驱动，
 * 不连数据库——DB 层语义由 functional spec 覆盖。
 */

import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  OPERATING_MAX_MERGE_WINDOW,
  buildOwningSurfaceDescriptor,
  makeScopedRef,
  type KnowledgeMemoryOperatingItem,
  type KnowledgeMemoryOperatingKind,
  type KnowledgeMemoryOperatingStatus,
  priorityForStatus,
  type OperatingListFilters,
} from '@aiproj/types'
import {
  buildCopilotMemoryFixture,
  buildKnowledgeItemFixture,
} from '@aiproj/types/knowledge-memory-operating-layer-fixtures'

import KnowledgeMemoryOperatingService, {
  OPERATING_LANE_TIMEOUT_MS,
  OperatingServiceError,
} from '../../app/services/knowledge_memory_operating/operating_service.js'
import {
  OperatingReadPortError,
  type OperatingCountInput,
  type OperatingCountResult,
  type OperatingGetInput,
  type OperatingGetResult,
  type OperatingListInput,
  type OperatingListResult,
  type OperatingReadContext,
  type OperatingReadPortRegistry,
  type OperatingResolveSurfaceInput,
  type OperatingResolveSurfaceResult,
} from '../../app/services/knowledge_memory_operating/port.js'
import {
  buildLaneCountResult,
  matchesOperatingFacets,
  takeOperatingWindow,
} from '../../app/services/knowledge_memory_operating/projection_helpers.js'

const CTX: OperatingReadContext = {
  organizationId: 1,
  actorId: 7,
  projectId: null,
  evalContext: false,
}

/** 用 change 自带的 fixture builder 造低敏投影（不手搓字面量，避免与契约漂移）。 */
function knowledgeItem(
  n: number,
  status: KnowledgeMemoryOperatingStatus,
  updatedAt: string,
): KnowledgeMemoryOperatingItem {
  const base = buildKnowledgeItemFixture({ orgId: 1, index: n, layer: 'L1', lifecycle: 'active' })
  return { ...base, status, priority: priorityForStatus(status), updatedAt }
}

/** 同上：copilot_memory 投影（不含 summary 内容，只有 byte size）。 */
function memoryItem(
  n: number,
  status: KnowledgeMemoryOperatingStatus,
  updatedAt: string,
): KnowledgeMemoryOperatingItem {
  const base = buildCopilotMemoryFixture({
    orgId: 1,
    index: n,
    statusDetail: 'candidate',
    memoryScope: 'user',
  })
  return { ...base, status, priority: priorityForStatus(status), updatedAt }
}

interface FakePortOptions {
  readonly items?: readonly KnowledgeMemoryOperatingItem[]
  /** 抛 port 错误：模拟单 lane 超时/解析失败。 */
  readonly fail?: boolean
  /** 记录每次 listWindow 收到的 limit，用于断言有界窗口。 */
  readonly seenLimits?: number[]
}

/**
 * 通用假 port。只实现接口方法，不含任何 owning command——
 * 这本身就是「聚合器只依赖只读端口」的运行时证据。
 */
function fakePort<K extends KnowledgeMemoryOperatingKind>(kind: K, opts: FakePortOptions = {}) {
  const all = opts.items ?? []
  return {
    kind,
    async countByFacets(input: OperatingCountInput): Promise<OperatingCountResult> {
      if (opts.fail) throw new OperatingReadPortError('OPERATING_PORT_TIMEOUT', kind, 'boom')
      const visible = all.filter((entry) =>
        matchesOperatingFacets(entry, { statuses: input.statuses }),
      )
      return buildLaneCountResult(visible, false)
    },
    async listWindow(input: OperatingListInput): Promise<OperatingListResult> {
      if (opts.fail) throw new OperatingReadPortError('OPERATING_PORT_TIMEOUT', kind, 'boom')
      opts.seenLimits?.push(input.limit)
      const filtered = all.filter((entry) =>
        matchesOperatingFacets(entry, { statuses: input.statuses, scopes: input.scopes }),
      )
      return {
        // 与真实 adapter 同一契约：先按规范序排序再截断，交出的必须是
        // 「全局最靠前的 N 项」而不是本 lane 自己的前 N 项。
        items: takeOperatingWindow(filtered, input.limit),
        laneTotal: filtered.length,
        degraded: false,
        queryMs: 0,
        queryCount: 1,
      }
    },
    async getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null> {
      const item = all.find((entry) => entry.scopedRef.ref === input.scopedRef.ref)
      if (!item) return null
      return {
        item,
        surfaces: [
          buildOwningSurfaceDescriptor({
            surface: 'knowledge_review',
            scopedRef: item.scopedRef,
            enabled: true,
            routeKey: '/knowledge',
            safeReturnContext: '知识审查',
          }),
        ],
        relatedCount: 0,
        fetchedAt: new Date(0).toISOString(),
      }
    },
    async resolveSurface(
      input: OperatingResolveSurfaceInput,
    ): Promise<OperatingResolveSurfaceResult | null> {
      const item = all.find((entry) => entry.scopedRef.ref === input.scopedRef.ref)
      // 服务端权威判定：找不到对象就没有 surface，无论客户端声称什么。
      if (!item) return null
      if (item.status === 'synthetic_eval_only') return null
      return {
        descriptor: buildOwningSurfaceDescriptor({
          surface: input.surface,
          scopedRef: item.scopedRef,
          enabled: true,
          routeKey: '/knowledge',
          safeReturnContext: '知识审查',
        }),
      }
    },
  }
}

function registry(over: Partial<Record<KnowledgeMemoryOperatingKind, FakePortOptions>> = {}) {
  return {
    knowledge: fakePort('knowledge_item', over.knowledge_item),
    memory: fakePort('copilot_memory', over.copilot_memory),
    skillDraft: fakePort('skill_knowledge_draft', over.skill_knowledge_draft),
    retrieval: fakePort('retrieval_signal', over.retrieval_signal),
  } as unknown as OperatingReadPortRegistry
}

function svc(over: Partial<Record<KnowledgeMemoryOperatingKind, FakePortOptions>> = {}) {
  return KnowledgeMemoryOperatingService.withPorts(registry(over))
}

const baseFilters: OperatingListFilters = { page: 1, perPage: 10 }

// ── 4.4 summary ──────────────────────────────────────────────────────

describe('getSummary —— 四 lane 计数与 coverage（§4.4）', () => {
  it('四 kind 各自成 lane，不被折叠', async () => {
    const s = svc({
      knowledge_item: { items: [knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z')] },
      copilot_memory: { items: [memoryItem(1, 'needs_review', '2026-08-02T00:00:00.000Z')] },
    })
    const summary = await s.getSummary(CTX)
    expect(summary.lanes.map((l) => l.lane).sort()).toEqual(
      [...KNOWLEDGE_MEMORY_OPERATING_KINDS].sort(),
    )
  })

  it('facet counts 反映真实派生状态，而不是把总数塞进第一个 facet', async () => {
    const s = svc({
      knowledge_item: {
        items: [
          knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z'),
          knowledgeItem(2, 'provenance_gap', '2026-08-01T00:00:00.000Z'),
          knowledgeItem(3, 'ready', '2026-08-01T00:00:00.000Z'),
        ],
      },
    })
    const summary = await s.getSummary(CTX)
    expect(summary.attentionFacetCounts.needs_review).toBe(1)
    expect(summary.attentionFacetCounts.provenance_gap).toBe(1)
    expect(summary.attentionFacetCounts.ready).toBe(1)
    expect(summary.attentionFacetCounts.conflict).toBe(0)
  })

  it('ready 不计入 attentionCount', async () => {
    const s = svc({
      knowledge_item: {
        items: [
          knowledgeItem(1, 'ready', '2026-08-01T00:00:00.000Z'),
          knowledgeItem(2, 'needs_review', '2026-08-01T00:00:00.000Z'),
        ],
      },
    })
    const summary = await s.getSummary(CTX)
    expect(summary.totalAttention).toBe(1)
  })

  it('lane 失败标 degraded 且不伪装为 ready（禁止 false-zero）', async () => {
    const s = svc({
      knowledge_item: { items: [knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z')] },
      skill_knowledge_draft: { fail: true },
    })
    const summary = await s.getSummary(CTX)
    const skillLane = summary.lanes.find((l) => l.lane === 'skill_knowledge_draft')!
    expect(skillLane.degraded).toBe(true)
    expect(skillLane.coverage).toBe('degraded')
    expect(summary.anyLaneDegraded).toBe(true)
    // 健康 lane 不受影响
    expect(summary.lanes.find((l) => l.lane === 'knowledge_item')!.degraded).toBe(false)
  })

  it('全空组织返回 empty coverage 而不是 degraded', async () => {
    const summary = await svc().getSummary(CTX)
    expect(summary.lanes.every((l) => l.coverage === 'empty')).toBe(true)
    expect(summary.anyLaneDegraded).toBe(false)
  })
})

// ── 4.6 list ─────────────────────────────────────────────────────────

describe('listItems —— 确定性合并与分页（§4.6）', () => {
  const knowledge = Array.from({ length: 7 }, (_, i) =>
    knowledgeItem(i + 1, 'needs_review', `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
  )
  const memory = Array.from({ length: 5 }, (_, i) =>
    memoryItem(i + 1, 'needs_review', `2026-08-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`),
  )

  it('相同输入产生相同结果（确定性）', async () => {
    const s = svc({ knowledge_item: { items: knowledge }, copilot_memory: { items: memory } })
    const a = await s.listItems(CTX, baseFilters)
    const b = await s.listItems(CTX, baseFilters)
    expect(a.data.map((i) => `${i.kind}:${i.scopedRef.ref}`)).toEqual(
      b.data.map((i) => `${i.kind}:${i.scopedRef.ref}`),
    )
  })

  it('相邻页无重复无遗漏，且并集等于全集', async () => {
    const s = svc({ knowledge_item: { items: knowledge }, copilot_memory: { items: memory } })
    const p1 = await s.listItems(CTX, { page: 1, perPage: 5 })
    const p2 = await s.listItems(CTX, { page: 2, perPage: 5 })
    const p3 = await s.listItems(CTX, { page: 3, perPage: 5 })
    const key = (i: KnowledgeMemoryOperatingItem) => `${i.kind}:${i.scopedRef.ref}`
    const ids = [...p1.data, ...p2.data, ...p3.data].map(key)
    expect(new Set(ids).size).toBe(ids.length) // 无重复
    expect(ids.length).toBe(knowledge.length + memory.length) // 无遗漏
  })

  it('total 是各 lane 权威总数之和，不随页大小缩水', async () => {
    const s = svc({ knowledge_item: { items: knowledge }, copilot_memory: { items: memory } })
    const p1 = await s.listItems(CTX, { page: 1, perPage: 3 })
    expect(p1.meta.total).toBe(12)
    expect(p1.meta.totalPages).toBe(4)
    expect(p1.data.length).toBe(3)
  })

  it('每个 lane 只被要求合并窗口大小的数据（有界 over-fetch）', async () => {
    const seenLimits: number[] = []
    const s = KnowledgeMemoryOperatingService.withPorts({
      knowledge: fakePort('knowledge_item', { items: knowledge, seenLimits }),
      memory: fakePort('copilot_memory', { items: memory, seenLimits }),
      skillDraft: fakePort('skill_knowledge_draft', { seenLimits }),
      retrieval: fakePort('retrieval_signal', { seenLimits }),
    } as unknown as OperatingReadPortRegistry)
    await s.listItems(CTX, { page: 2, perPage: 5 })
    // page 2 x perPage 5 → 每 lane 需要前 10 项
    expect(new Set(seenLimits)).toEqual(new Set([10]))
  })

  it('超出合并窗口的深页显式拒绝，而不是静默返回空页', async () => {
    const s = svc({ knowledge_item: { items: knowledge } })
    const tooDeep = Math.ceil(OPERATING_MAX_MERGE_WINDOW / 100) + 1
    await expect(s.listItems(CTX, { page: tooDeep, perPage: 100 })).rejects.toBeInstanceOf(
      OperatingServiceError,
    )
  })

  it('非法 page / perPage 被拒绝', async () => {
    const s = svc()
    await expect(s.listItems(CTX, { page: 0, perPage: 10 })).rejects.toBeInstanceOf(
      OperatingServiceError,
    )
    await expect(s.listItems(CTX, { page: 1, perPage: 0 })).rejects.toBeInstanceOf(
      OperatingServiceError,
    )
    await expect(s.listItems(CTX, { page: 1, perPage: 101 })).rejects.toBeInstanceOf(
      OperatingServiceError,
    )
  })

  it('单 lane 失败被隔离：其它 lane 仍返回，失败 lane 进 degradedLanes', async () => {
    const s = svc({
      knowledge_item: { items: knowledge },
      copilot_memory: { items: memory },
      skill_knowledge_draft: { fail: true },
    })
    const res = await s.listItems(CTX, baseFilters)
    expect(res.meta.degradedLanes).toContain('skill_knowledge_draft')
    expect(res.data.some((i) => i.kind === 'knowledge_item')).toBe(true)
    expect(res.data.some((i) => i.kind === 'copilot_memory')).toBe(true)
  })

  it('kind 过滤只查被请求的 lane', async () => {
    const s = svc({ knowledge_item: { items: knowledge }, copilot_memory: { items: memory } })
    const res = await s.listItems(CTX, { ...baseFilters, kinds: ['knowledge_item'] })
    expect(res.data.every((i) => i.kind === 'knowledge_item')).toBe(true)
    expect(res.meta.total).toBe(knowledge.length)
  })

  it('filtered-empty 与 empty 都返回 0 但不标 degraded', async () => {
    const s = svc({ knowledge_item: { items: knowledge } })
    const res = await s.listItems(CTX, { ...baseFilters, statuses: ['conflict'] })
    expect(res.data).toHaveLength(0)
    expect(res.meta.total).toBe(0)
    expect(res.meta.degradedLanes).toHaveLength(0)
  })
})

// ── 4.9 / 4.10 surface ───────────────────────────────────────────────

describe('resolveSurface —— 服务端权威判定（§4.9/§4.10）', () => {
  it('descriptor 不含 callback / href / 请求体 / preview token / confirm handle', async () => {
    const item = knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z')
    const s = svc({ knowledge_item: { items: [item] } })
    const d = await s.resolveSurface(CTX, item.scopedRef, 'knowledge_review')
    expect(d).not.toBeNull()
    const keys = Object.keys(d!)
    for (const forbidden of ['callback', 'href', 'url', 'body', 'previewToken', 'confirmHandle']) {
      expect(keys).not.toContain(forbidden)
    }
    expect(d!.authorityOwner).toBeTruthy()
  })

  it('对象不可见时 surface 解析为 null——客户端本地改 enabled 无效', async () => {
    const s = svc({ knowledge_item: { items: [] } })
    const d = await s.resolveSurface(
      CTX,
      makeScopedRef('knowledge_item', 'k-999'),
      'knowledge_review',
    )
    expect(d).toBeNull()
  })

  it('L3 synthetic 条目的 surface fail closed', async () => {
    const item = knowledgeItem(1, 'synthetic_eval_only', '2026-08-01T00:00:00.000Z')
    const s = svc({ knowledge_item: { items: [item] } })
    const d = await s.resolveSurface(CTX, item.scopedRef, 'knowledge_review')
    expect(d).toBeNull()
  })

  it('未知 kind 的 scopedRef fail closed', async () => {
    const s = svc()
    const d = await s.resolveSurface(
      CTX,
      { kind: 'project_event', ref: 'p-1' } as never,
      'knowledge_review',
    )
    expect(d).toBeNull()
    const detail = await s.getItemDetail(CTX, { kind: 'project_event', ref: 'p-1' } as never)
    expect(detail).toBeNull()
  })
})

// ── 3.12 / 3.13 lane 超时与输出 allowlist ─────────────────────────────

describe('lane 超时、无重试与输出 allowlist（§3.12/§3.13）', () => {
  it('lane 超时被隔离成 degraded，且只调用一次（无自动重试）', async () => {
    let calls = 0
    const slow = {
      kind: 'skill_knowledge_draft' as const,
      async countByFacets() {
        calls += 1
        await new Promise((r) => setTimeout(r, OPERATING_LANE_TIMEOUT_MS + 50))
        return buildLaneCountResult([], false)
      },
      async listWindow(): Promise<OperatingListResult> {
        calls += 1
        await new Promise((r) => setTimeout(r, OPERATING_LANE_TIMEOUT_MS + 50))
        return { items: [], laneTotal: 0, degraded: false, queryMs: 0, queryCount: 1 }
      },
      async getProjection() {
        return null
      },
      async resolveSurface() {
        return null
      },
    }
    const s = KnowledgeMemoryOperatingService.withPorts({
      knowledge: fakePort('knowledge_item', {
        items: [knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z')],
      }),
      memory: fakePort('copilot_memory'),
      skillDraft: slow,
      retrieval: fakePort('retrieval_signal'),
    } as unknown as OperatingReadPortRegistry)

    const res = await s.listItems(CTX, baseFilters)
    expect(res.meta.degradedLanes).toContain('skill_knowledge_draft')
    // 健康 lane 不受影响
    expect(res.data.some((i) => i.kind === 'knowledge_item')).toBe(true)
    // 超时后不重试
    expect(calls).toBe(1)
  }, 20_000)

  it('adapter 输出未声明字段时整条 lane 被拦下（allowlist 而非 denylist）', async () => {
    const leaky = knowledgeItem(1, 'needs_review', '2026-08-01T00:00:00.000Z')
    // 模拟 adapter 违规：新增一个未声明的字段来夹带正文
    const tainted = {
      ...leaky,
      rawBody: '知识正文-should-not-leak',
    } as unknown as KnowledgeMemoryOperatingItem

    const s = svc({ knowledge_item: { items: [tainted] } })
    const res = await s.listItems(CTX, baseFilters)
    expect(res.data).toHaveLength(0)
    expect(res.meta.degradedLanes).toContain('knowledge_item')
    expect(JSON.stringify(res)).not.toContain('should-not-leak')
  })
})
