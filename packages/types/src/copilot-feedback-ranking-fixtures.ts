/**
 * v3-copilot-feedback-driven-ranking — 五态 fixtures
 *
 * 覆盖：开关关闭、开启无历史、开启有拒绝历史、权重触界、跨严重度不越界。
 * 全部使用确定性数据，零网络 / 零 provider。
 */

import type {
  FeedbackWeightedProjection,
  FeedbackWeightedProjectionSnapshot,
} from './copilot-feedback-ranking.js'
import type { InboxEntry } from './copilot-suggestion-inbox.js'
import { WEIGHT_BOUNDS } from './copilot-feedback-ranking.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ORG_ID = 1
const ACTOR_ID = 100
const NOW = '2026-08-18T10:00:00.000Z'

// ---------------------------------------------------------------------------
// 条目工厂
// ---------------------------------------------------------------------------

export function makeRankingEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: String(ORG_ID),
    projectId: 'proj-001',
    state: 'unread',
    problemKind: 'resource_overload',
    severity: 'high',
    dedupeKey: { problemKind: 'resource_overload', declaredKey: 'dk-001' },
    sourceRefs: [
      {
        sourceKind: 'smart_recommendation',
        sourceId: 'rec-001',
        projectId: 'proj-001',
        sourceHash: 'hash-001',
        capturedAt: NOW,
      },
    ],
    expiryReason: null,
    expiryDetail: null,
    createdAt: NOW,
    updatedAt: NOW,
    readAt: null,
    actionedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 态 1：开关关闭
// ---------------------------------------------------------------------------

/**
 * 开关关闭态：排序与既有确定性排序完全一致。
 * 无投影读取发生。
 */
export function fixtureSwitchOff(): {
  entries: InboxEntry[]
  expectedOrder: string[]
} {
  const entries = [
    makeRankingEntry({
      id: 'off-001',
      severity: 'critical',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
    makeRankingEntry({
      id: 'off-002',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'schedule_risk',
    }),
    makeRankingEntry({
      id: 'off-003',
      severity: 'medium',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'dependency_block',
    }),
  ]
  return {
    entries,
    expectedOrder: ['off-001', 'off-002', 'off-003'],
  }
}

// ---------------------------------------------------------------------------
// 态 2：开启无历史
// ---------------------------------------------------------------------------

/**
 * 开启但无反馈历史：排序与既有确定性排序完全一致。
 * 投影为空，所有权重为 0。
 */
export function fixtureEnabledNoHistory(): {
  entries: InboxEntry[]
  projections: FeedbackWeightedProjection[]
  expectedOrder: string[]
} {
  const entries = [
    makeRankingEntry({
      id: 'nohist-001',
      severity: 'critical',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
    makeRankingEntry({
      id: 'nohist-002',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'schedule_risk',
    }),
  ]
  return {
    entries,
    projections: [],
    expectedOrder: ['nohist-001', 'nohist-002'],
  }
}

// ---------------------------------------------------------------------------
// 态 3：开启有拒绝历史
// ---------------------------------------------------------------------------

/**
 * 开启且有拒绝历史：被多次拒绝的同类建议在同严重度内降权。
 */
export function fixtureEnabledWithRejectionHistory(): {
  entries: InboxEntry[]
  projections: FeedbackWeightedProjection[]
  expectedOrder: string[]
  expectedExplanations: { entryId: string; rejectionCount: number }[]
} {
  const entries = [
    makeRankingEntry({
      id: 'rej-001',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
    makeRankingEntry({
      id: 'rej-002',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'schedule_risk',
    }),
    makeRankingEntry({
      id: 'rej-003',
      severity: 'high',
      createdAt: '2026-08-16T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
  ]
  const projections: FeedbackWeightedProjection[] = [
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'resource_overload',
      rejectionCount: 3,
      adoptionCount: 1,
      weight: -3,
      projectionVersion: 'proj-v1',
    },
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'schedule_risk',
      rejectionCount: 0,
      adoptionCount: 2,
      weight: 0,
      projectionVersion: 'proj-v1',
    },
  ]
  return {
    entries,
    projections,
    expectedOrder: ['rej-002', 'rej-003', 'rej-001'],
    expectedExplanations: [{ entryId: 'rej-001', rejectionCount: 3 }],
  }
}

// ---------------------------------------------------------------------------
// 态 4：权重触界
// ---------------------------------------------------------------------------

/**
 * 权重触界：拒绝次数超过上限时，权重被截断到 maxNegativeWeight。
 */
export function fixtureWeightAtBounds(): {
  entries: InboxEntry[]
  projections: FeedbackWeightedProjection[]
  expectedWeights: { problemKind: string; expectedWeight: number }[]
} {
  const entries = [
    makeRankingEntry({
      id: 'bound-001',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
    makeRankingEntry({
      id: 'bound-002',
      severity: 'high',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'schedule_risk',
    }),
  ]
  const projections: FeedbackWeightedProjection[] = [
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'resource_overload',
      rejectionCount: 10,
      adoptionCount: 0,
      weight: WEIGHT_BOUNDS.maxNegativeWeight,
      projectionVersion: 'proj-v1',
    },
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'schedule_risk',
      rejectionCount: 0,
      adoptionCount: 10,
      weight: WEIGHT_BOUNDS.maxPositiveWeight,
      projectionVersion: 'proj-v1',
    },
  ]
  return {
    entries,
    projections,
    expectedWeights: [
      { problemKind: 'resource_overload', expectedWeight: WEIGHT_BOUNDS.maxNegativeWeight },
      { problemKind: 'schedule_risk', expectedWeight: WEIGHT_BOUNDS.maxPositiveWeight },
    ],
  }
}

// ---------------------------------------------------------------------------
// 态 5：跨严重度不越界
// ---------------------------------------------------------------------------

/**
 * 跨严重度不越界：任何权重取值下，高严重度条目恒在低严重度之前。
 */
export function fixtureCrossSeverityNoCrossing(): {
  entries: InboxEntry[]
  projections: FeedbackWeightedProjection[]
  expectedOrder: string[]
} {
  const entries = [
    makeRankingEntry({
      id: 'cross-001',
      severity: 'low',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
    }),
    makeRankingEntry({
      id: 'cross-002',
      severity: 'critical',
      createdAt: '2026-08-15T10:00:00.000Z',
      problemKind: 'schedule_risk',
    }),
  ]
  const projections: FeedbackWeightedProjection[] = [
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'resource_overload',
      rejectionCount: 10,
      adoptionCount: 0,
      weight: WEIGHT_BOUNDS.maxNegativeWeight,
      projectionVersion: 'proj-v1',
    },
    {
      actorId: ACTOR_ID,
      organizationId: ORG_ID,
      problemKind: 'schedule_risk',
      rejectionCount: 0,
      adoptionCount: 10,
      weight: WEIGHT_BOUNDS.maxPositiveWeight,
      projectionVersion: 'proj-v1',
    },
  ]
  return {
    entries,
    projections,
    expectedOrder: ['cross-002', 'cross-001'],
  }
}

// ---------------------------------------------------------------------------
// 投影快照工厂
// ---------------------------------------------------------------------------

export function makeProjectionSnapshot(
  projections: FeedbackWeightedProjection[],
  version: string = 'proj-v1',
): FeedbackWeightedProjectionSnapshot {
  return {
    version,
    generatedAt: NOW,
    entries: projections,
  }
}
