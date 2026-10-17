/**
 * Draft Layer Handoff 纯逻辑单元测试。
 *
 * 覆盖 handoff_service.ts 中私有纯逻辑：
 * - estimateEntityCount: PDM 实体计数
 * - hasBlockingHumanReview: Ledger 阻塞检查
 * - getBlockingItems: 阻塞项摘要提取
 *
 * 以及 DraftLayerPdmHandoff 接口的 fixture 验证。
 * 不依赖 AdonisJS 容器 / Lucid ORM。
 */

import { describe, expect, it } from 'vitest'
import type { DraftLayerPdmHandoff } from '@aiproj/types'

// ---------------------------------------------------------------------------
// PDM 实体计数投影函数（从 PDM payload 估算 Draft Layer 实体数量）
// ---------------------------------------------------------------------------

interface PdmPayload {
  workstreams?: unknown[]
  workPackages?: unknown[]
  tasks?: unknown[]
  milestones?: unknown[]
  [key: string]: unknown
}

function estimateEntityCount(payload: PdmPayload | null | undefined): number {
  if (!payload || typeof payload !== 'object') return 0
  let count = 0
  if (Array.isArray(payload.workstreams)) count += payload.workstreams.length
  if (Array.isArray(payload.workPackages)) count += payload.workPackages.length
  if (Array.isArray(payload.tasks)) count += payload.tasks.length
  if (Array.isArray(payload.milestones)) count += payload.milestones.length
  return count
}

// ---------------------------------------------------------------------------
// Ledger 阻塞检查逻辑（从 CompletenessLedger 提取）
// ---------------------------------------------------------------------------

interface LedgerEntry {
  entityId?: string
  description?: string
  status: string
  blocking?: boolean
}

interface CompletenessLedgerLike {
  entries?: LedgerEntry[]
  [key: string]: unknown
}

function hasBlockingHumanReview(ledger: CompletenessLedgerLike | null | undefined): boolean {
  if (!ledger?.entries) return false
  return ledger.entries.some(
    (entry) => entry.status === 'needs_human_review' && entry.blocking !== false,
  )
}

function getBlockingItems(ledger: CompletenessLedgerLike | null | undefined): string[] {
  if (!ledger?.entries) return []
  return ledger.entries
    .filter((entry) => entry.status === 'needs_human_review' && entry.blocking !== false)
    .map((entry) => entry.description ?? entry.entityId ?? 'Unknown')
}

// ---------------------------------------------------------------------------
// Handoff 状态判断函数（从 ledger 状态推断 handoff status）
// ---------------------------------------------------------------------------

type HandoffStatus = 'ready_to_handoff' | 'needs_human_review' | 'blocked'

function determineHandoffStatus(
  ledger: CompletenessLedgerLike | null | undefined,
  pdmExists: boolean,
): HandoffStatus {
  if (!pdmExists) return 'blocked'
  if (!ledger) return 'ready_to_handoff'
  if (hasBlockingHumanReview(ledger)) return 'needs_human_review'

  // 非阻塞 needs_human_review 视同 completed 不阻拦
  const allNonBlockingComplete =
    ledger.entries?.every(
      (e) =>
        e.status === 'completed' ||
        e.status === 'passed' ||
        (e.status === 'needs_human_review' && e.blocking === false),
    ) ?? true
  if (!allNonBlockingComplete) return 'blocked'

  return 'ready_to_handoff'
}

// ---------------------------------------------------------------------------
// PDM 实体计数测试
// ---------------------------------------------------------------------------

describe('PDM 实体计数 estimateEntityCount', () => {
  it('空 payload 返回 0', () => {
    expect(estimateEntityCount({})).toBe(0)
  })

  it('null/undefined payload 返回 0', () => {
    expect(estimateEntityCount(null)).toBe(0)
    expect(estimateEntityCount(undefined)).toBe(0)
  })

  it('非对象 payload 返回 0', () => {
    expect(estimateEntityCount('string' as unknown as PdmPayload)).toBe(0)
    expect(estimateEntityCount(42 as unknown as PdmPayload)).toBe(0)
  })

  it('统计四个数组长度之和', () => {
    const payload: PdmPayload = {
      workstreams: [{ id: 'WS1' }, { id: 'WS2' }],
      workPackages: [{ id: 'WP1' }],
      tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }],
      milestones: [{ id: 'M1' }],
    }
    expect(estimateEntityCount(payload)).toBe(7) // 2 + 1 + 3 + 1
  })

  it('部分数组缺失时仅统计存在的', () => {
    const payload: PdmPayload = {
      workstreams: [{ id: 'WS1' }],
      tasks: [{ id: 'T1' }, { id: 'T2' }],
    }
    expect(estimateEntityCount(payload)).toBe(3)
  })

  it('空数组不增加计数', () => {
    const payload: PdmPayload = {
      workstreams: [],
      workPackages: [],
      tasks: [],
      milestones: [],
    }
    expect(estimateEntityCount(payload)).toBe(0)
  })

  it('非数组字段被忽略', () => {
    const payload: PdmPayload = {
      workstreams: [{ id: 'WS1' }],
      workPackages: 'not-array' as unknown as unknown[],
      metadata: { some: 'data' },
      description: 'test',
    }
    expect(estimateEntityCount(payload)).toBe(1) // 只 workstreams 有效
  })

  it('带有额外字段的 PDM 只会计数指定字段', () => {
    const payload: PdmPayload = {
      workstreams: Array.from({ length: 5 }, (_, i) => ({ id: `WS${i}` })),
      tasks: Array.from({ length: 20 }, (_, i) => ({ id: `T${i}` })),
      // risks 和 resources 不应计入
      risks: Array.from({ length: 10 }, (_, i) => ({ id: `R${i}` })),
      resources: Array.from({ length: 8 }, (_, i) => ({ id: `RES${i}` })),
    }
    expect(estimateEntityCount(payload)).toBe(25) // 5 + 20
  })
})

// ---------------------------------------------------------------------------
// Ledger 阻塞检查测试
// ---------------------------------------------------------------------------

describe('Ledger 阻塞检查 hasBlockingHumanReview', () => {
  it('无 entries 时返回 false', () => {
    expect(hasBlockingHumanReview(null)).toBe(false)
    expect(hasBlockingHumanReview(undefined)).toBe(false)
    expect(hasBlockingHumanReview({})).toBe(false)
    expect(hasBlockingHumanReview({ entries: [] })).toBe(false)
  })

  it('有 needs_human_review 且 blocking !== false 时返回 true', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'needs_human_review', description: '需要确认开始日期' },
      ],
    }
    expect(hasBlockingHumanReview(ledger)).toBe(true)
  })

  it('needs_human_review 但 blocking=false 时不阻塞', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'needs_human_review', blocking: false, description: '建议优化' },
      ],
    }
    expect(hasBlockingHumanReview(ledger)).toBe(false)
  })

  it('无 needs_human_review 项时返回 false', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'failed' },
      ],
    }
    expect(hasBlockingHumanReview(ledger)).toBe(false)
  })

  it('多个条目混合时正确判断', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'needs_human_review', blocking: true, description: '检查依赖' },
        { entityId: 'E3', status: 'needs_human_review', blocking: false, description: '可选优化' },
        { entityId: 'E4', status: 'passed' },
      ],
    }
    // E2 是 blocking, E3 不是 — 所以有阻塞项
    expect(hasBlockingHumanReview(ledger)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 阻塞项摘要提取测试
// ---------------------------------------------------------------------------

describe('阻塞项摘要提取 getBlockingItems', () => {
  it('无 entries 时返回空数组', () => {
    expect(getBlockingItems(null)).toEqual([])
    expect(getBlockingItems(undefined)).toEqual([])
    expect(getBlockingItems({})).toEqual([])
  })

  it('提取 blocking needs_human_review 项的 description', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'needs_human_review', description: '工期冲突' },
        { entityId: 'E2', status: 'needs_human_review', description: '资源不足' },
      ],
    }
    expect(getBlockingItems(ledger)).toEqual(['工期冲突', '资源不足'])
  })

  it('description 缺失时使用 entityId', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'needs_human_review' },
        { entityId: 'E2', status: 'needs_human_review', description: '资源不足' },
      ],
    }
    expect(getBlockingItems(ledger)).toEqual(['E1', '资源不足'])
  })

  it('description 和 entityId 都缺失时使用 Unknown', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [{ status: 'needs_human_review' } as LedgerEntry],
    }
    expect(getBlockingItems(ledger)).toEqual(['Unknown'])
  })

  it('非阻塞 needs_human_review 不被提取', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'needs_human_review', blocking: false, description: '可选建议' },
        { entityId: 'E2', status: 'needs_human_review', description: '阻塞项' },
      ],
    }
    expect(getBlockingItems(ledger)).toEqual(['阻塞项'])
  })

  it('completed 和 passed 条目不被提取', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'passed' },
      ],
    }
    expect(getBlockingItems(ledger)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Handoff 状态判断测试
// ---------------------------------------------------------------------------

describe('Handoff 状态判断 determineHandoffStatus', () => {
  it('PDM 不存在时返回 blocked', () => {
    expect(determineHandoffStatus(null, false)).toBe('blocked')
    expect(determineHandoffStatus({ entries: [] }, false)).toBe('blocked')
  })

  it('无 ledger 时返回 ready_to_handoff', () => {
    expect(determineHandoffStatus(null, true)).toBe('ready_to_handoff')
    expect(determineHandoffStatus(undefined, true)).toBe('ready_to_handoff')
  })

  it('所有条目完成时返回 ready_to_handoff', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'passed' },
      ],
    }
    expect(determineHandoffStatus(ledger, true)).toBe('ready_to_handoff')
  })

  it('有未完成条目时返回 blocked', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'pending' },
      ],
    }
    expect(determineHandoffStatus(ledger, true)).toBe('blocked')
  })

  it('有 blocking needs_human_review 时返回 needs_human_review', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'needs_human_review', description: '需确认范围' },
      ],
    }
    expect(determineHandoffStatus(ledger, true)).toBe('needs_human_review')
  })

  it('所有条目完成 + 非阻塞 needs_human_review 时返回 ready', () => {
    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'E1', status: 'completed' },
        { entityId: 'E2', status: 'needs_human_review', blocking: false, description: '可选优化' },
      ],
    }
    expect(determineHandoffStatus(ledger, true)).toBe('ready_to_handoff')
  })

  it('空 entries 视为全都完成', () => {
    expect(determineHandoffStatus({ entries: [] }, true)).toBe('ready_to_handoff')
  })
})

// ---------------------------------------------------------------------------
// DraftLayerPdmHandoff 接口 fixture 验证
// ---------------------------------------------------------------------------

describe('DraftLayerPdmHandoff 接口 fixture', () => {
  it('ready_to_handoff 状态 fixture', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 100,
      pdmArtifactId: 'pdm:v1',
      pdmHash: 'abc123def456',
      ledgerSummary: {
        totalEntities: 10,
        completedEntities: 10,
        needsHumanReview: false,
        blockingItems: [],
        hasBlockingHumanReview: false,
      },
      status: 'ready_to_handoff',
    }
    expect(handoff.status).toBe('ready_to_handoff')
    expect(handoff.ledgerSummary.totalEntities).toBe(10)
    expect(handoff.ledgerSummary.completedEntities).toBe(10)
    expect(handoff.ledgerSummary.blockingItems).toHaveLength(0)
    expect(handoff.ledgerSummary.hasBlockingHumanReview).toBe(false)
  })

  it('needs_human_review 状态 fixture', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 101,
      pdmArtifactId: 'pdm:v2',
      pdmHash: 'hash789',
      ledgerSummary: {
        totalEntities: 15,
        completedEntities: 13,
        needsHumanReview: true,
        blockingItems: ['需确认工期冲突', '需确认资源分配'],
        hasBlockingHumanReview: true,
      },
      status: 'needs_human_review',
    }
    expect(handoff.status).toBe('needs_human_review')
    expect(handoff.ledgerSummary.blockingItems).toHaveLength(2)
    expect(handoff.ledgerSummary.blockingItems[0]).toContain('工期冲突')
    expect(handoff.ledgerSummary.hasBlockingHumanReview).toBe(true)
  })

  it('blocked 状态 fixture', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 102,
      pdmArtifactId: 'pdm:v3',
      pdmHash: 'hash000',
      ledgerSummary: {
        totalEntities: 20,
        completedEntities: 8,
        needsHumanReview: true,
        blockingItems: ['编译尚未完成'],
        hasBlockingHumanReview: true,
      },
      status: 'blocked',
    }
    expect(handoff.status).toBe('blocked')
    expect(handoff.ledgerSummary.completedEntities).toBeLessThan(
      handoff.ledgerSummary.totalEntities,
    )
    expect(handoff.ledgerSummary.blockingItems).toContain('编译尚未完成')
  })

  it('ledger 摘要中 totalEntities >= completedEntities', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 200,
      pdmArtifactId: 'pdm:v4',
      pdmHash: 'integral_hash',
      ledgerSummary: {
        totalEntities: 30,
        completedEntities: 25,
        needsHumanReview: false,
        blockingItems: [],
        hasBlockingHumanReview: false,
      },
      status: 'blocked',
    }
    expect(handoff.ledgerSummary.completedEntities).toBeLessThanOrEqual(
      handoff.ledgerSummary.totalEntities,
    )
  })

  it('completedEntities 为 0 的初始状态 fixture', () => {
    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 300,
      pdmArtifactId: 'pdm:v0',
      pdmHash: 'initial_hash',
      ledgerSummary: {
        totalEntities: 5,
        completedEntities: 0,
        needsHumanReview: false,
        blockingItems: [],
        hasBlockingHumanReview: false,
      },
      status: 'blocked',
    }
    expect(handoff.ledgerSummary.completedEntities).toBe(0)
    expect(handoff.status).toBe('blocked')
  })
})

// ---------------------------------------------------------------------------
// 组合场景：从 PDM + Ledger 构建完整 Handoff 对象
// ---------------------------------------------------------------------------

describe('从 PDM + Ledger 构建 Handoff', () => {
  it('完整的 PDM + 完成的 Ledger = ready_to_handoff', () => {
    const pdmPayload: PdmPayload = {
      workstreams: [
        { id: 'WS1', name: '需求分析' },
        { id: 'WS2', name: '系统设计' },
      ],
      workPackages: [{ id: 'WP1', name: '调研' }],
      tasks: [
        { id: 'T1', name: '任务1' },
        { id: 'T2', name: '任务2' },
      ],
      milestones: [{ id: 'M1', name: '里程碑1' }],
    }

    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'WS1', status: 'completed' },
        { entityId: 'WS2', status: 'completed' },
        { entityId: 'WP1', status: 'completed' },
        { entityId: 'T1', status: 'completed' },
        { entityId: 'T2', status: 'completed' },
        { entityId: 'M1', status: 'completed' },
      ],
    }

    const entityCount = estimateEntityCount(pdmPayload)
    const blockingItems = getBlockingItems(ledger)
    const blocking = hasBlockingHumanReview(ledger)
    const status = determineHandoffStatus(ledger, true)

    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 1,
      pdmArtifactId: 'pdm:complete',
      pdmHash: 'complete_hash',
      ledgerSummary: {
        totalEntities: entityCount,
        completedEntities: entityCount,
        needsHumanReview: blocking,
        blockingItems,
        hasBlockingHumanReview: blocking,
      },
      status,
    }

    expect(handoff.ledgerSummary.totalEntities).toBe(6)
    expect(handoff.ledgerSummary.completedEntities).toBe(6)
    expect(handoff.status).toBe('ready_to_handoff')
  })

  it('PDM 实体多但 Ledger 未完成 = blocked', () => {
    const pdmPayload: PdmPayload = {
      workstreams: [{ id: 'WS1' }],
      tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }, { id: 'T4' }, { id: 'T5' }],
    }

    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'WS1', status: 'completed' },
        { entityId: 'T1', status: 'completed' },
        { entityId: 'T2', status: 'completed' },
        { entityId: 'T3', status: 'pending' },
        { entityId: 'T4', status: 'pending' },
        { entityId: 'T5', status: 'pending' },
      ],
    }

    const entityCount = estimateEntityCount(pdmPayload)
    const completed = ledger.entries?.filter((e) => e.status === 'completed').length ?? 0
    const status = determineHandoffStatus(ledger, true)

    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 2,
      pdmArtifactId: 'pdm:partial',
      pdmHash: 'partial_hash',
      ledgerSummary: {
        totalEntities: entityCount,
        completedEntities: completed,
        needsHumanReview: false,
        blockingItems: [],
        hasBlockingHumanReview: false,
      },
      status,
    }

    expect(handoff.ledgerSummary.totalEntities).toBe(6)
    expect(handoff.ledgerSummary.completedEntities).toBe(3)
    expect(handoff.status).toBe('blocked')
  })

  it('PDM 已就绪 + Ledger 有阻塞人工审查项 = needs_human_review', () => {
    const pdmPayload: PdmPayload = {
      workstreams: [{ id: 'WS1' }],
      tasks: [{ id: 'T1' }, { id: 'T2' }],
    }

    const ledger: CompletenessLedgerLike = {
      entries: [
        { entityId: 'WS1', status: 'completed' },
        { entityId: 'T1', status: 'completed' },
        { entityId: 'T2', status: 'completed' },
        {
          entityId: 'T2_dates',
          status: 'needs_human_review',
          description: '任务 T2 的结束日期为周日，请确认',
        },
      ],
    }

    const entityCount = estimateEntityCount(pdmPayload)
    const blockingItems = getBlockingItems(ledger)
    const blocking = hasBlockingHumanReview(ledger)
    const status = determineHandoffStatus(ledger, true)

    const handoff: DraftLayerPdmHandoff = {
      compilerRunId: 3,
      pdmArtifactId: 'pdm:review',
      pdmHash: 'review_hash',
      ledgerSummary: {
        totalEntities: entityCount,
        completedEntities: 3,
        needsHumanReview: blocking,
        blockingItems,
        hasBlockingHumanReview: blocking,
      },
      status,
    }

    expect(handoff.status).toBe('needs_human_review')
    expect(handoff.ledgerSummary.blockingItems).toContain('任务 T2 的结束日期为周日，请确认')
    expect(handoff.ledgerSummary.hasBlockingHumanReview).toBe(true)
  })
})
