/**
 * v3-triz-decision-center fixtures —— TRIZ 决策中心确定性测试夹具。
 *
 * 覆盖：可见来源、stale 来源、缺失权限、Draft 阻断、近期决策、AI fallback、空状态。
 */

import type {
  TrizDecisionCenterItem,
  TrizDecisionCenterSummary,
  TrizDecisionCenterDetail,
  TrizDecisionCenterSourceDigest,
  TrizDecisionCenterWarning,
  TrizDecisionCenterTimelineEvent,
} from './triz-decision-center.js'

// ---------------------------------------------------------------------------
// 基础夹具
// ---------------------------------------------------------------------------

export function fixtureVisibleSourceDigest(
  overrides: Partial<TrizDecisionCenterSourceDigest> = {},
): TrizDecisionCenterSourceDigest {
  return {
    sourceKind: 'contradiction',
    sourceId: 'contra-001',
    sourceHash: 'abc123',
    title: '速度 vs 精度 技术矛盾',
    summary: '改善参数：速度(9)，恶化参数：精度(28)',
    navigationRef: '/projects/1/triz/contradictions/1',
    accessible: true,
    ...overrides,
  }
}

export function fixtureStaleSourceDigest(
  overrides: Partial<TrizDecisionCenterSourceDigest> = {},
): TrizDecisionCenterSourceDigest {
  return {
    sourceKind: 'compiler_triz_analysis',
    sourceId: 'artifact-001',
    sourceHash: 'old_hash_123',
    title: 'Compiler TRIZ 分析结果',
    summary: 'TRIZ Stage 3 分析输出，检测到 2 个技术矛盾候选',
    navigationRef: '/projects/1/compiler/artifacts/1',
    accessible: true,
    ...overrides,
  }
}

export function fixtureInaccessibleSourceDigest(
  overrides: Partial<TrizDecisionCenterSourceDigest> = {},
): TrizDecisionCenterSourceDigest {
  return {
    sourceKind: 'recommendation_rationale',
    sourceId: 'rationale-001',
    sourceHash: 'no_access',
    title: '',
    summary: null,
    navigationRef: null,
    accessible: false,
    ...overrides,
  }
}

export function fixtureWarning(
  overrides: Partial<TrizDecisionCenterWarning> = {},
): TrizDecisionCenterWarning {
  return {
    code: 'TRIZ_DC_STALE_SOURCE_HASH',
    message: '来源 hash 已过期，需要刷新后才能进行审查',
    details: ['当前 hash: new_hash_456', '记录 hash: old_hash_123'],
    ...overrides,
  }
}

export function fixtureDecisionCenterItem(
  overrides: Partial<TrizDecisionCenterItem> = {},
): TrizDecisionCenterItem {
  return {
    id: 'dc-abc12345',
    projectId: 1,
    organizationId: 1,
    queueStatus: 'pending_decision',
    source: fixtureVisibleSourceDigest(),
    subjectSummary: '速度 vs 精度 技术矛盾需要人工决策',
    priority: 7,
    warnings: [],
    relatedDecisionLogIds: [],
    readiness: 'not_ready',
    allowedActions: ['adopt', 'reject', 'view_detail', 'generate_reason_draft'],
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    hasAccess: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 场景夹具
// ---------------------------------------------------------------------------

/** 可见来源队列：一个完整的混合队列 */
export function fixtureMixedQueue(): TrizDecisionCenterItem[] {
  return [
    fixtureDecisionCenterItem({
      id: 'dc-item-001',
      queueStatus: 'pending_decision',
      source: fixtureVisibleSourceDigest(),
      priority: 8,
      warnings: [],
    }),
    fixtureDecisionCenterItem({
      id: 'dc-item-002',
      queueStatus: 'stale_source',
      source: fixtureStaleSourceDigest(),
      priority: 9,
      warnings: [fixtureWarning()],
    }),
    fixtureDecisionCenterItem({
      id: 'dc-item-003',
      queueStatus: 'missing_reason',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'innovation_workbench',
        sourceId: 'scheme-001',
        sourceHash: 'def456',
        title: '方案 A: 提前缓冲 + 错峰排程',
        summary: '创新方案，尚未补充决策理由',
        navigationRef: '/projects/1/triz/workbench/schemes/1',
      }),
      priority: 5,
      warnings: [
        {
          code: 'TRIZ_DC_NO_DECISION_LOG',
          message: '无关联决策日志',
        },
      ],
    }),
    fixtureDecisionCenterItem({
      id: 'dc-item-004',
      queueStatus: 'ready_for_draft',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'decision_log',
        sourceId: 'decision-001',
        sourceHash: 'ghi789',
        title: '已决策：采纳方案 A',
        summary: '2026-07-30 确认采纳，等待进入 Draft 审查',
      }),
      priority: 3,
      warnings: [],
      readiness: 'ready',
      relatedDecisionLogIds: [1],
      allowedActions: ['start_draft_review', 'view_detail', 'supersede'],
    }),
    fixtureDecisionCenterItem({
      id: 'dc-item-005',
      queueStatus: 'blocked',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'draft_blocker',
        sourceId: 'blocker-001',
        sourceHash: 'jkl012',
        title: 'Draft 阻断：缺少 TRIZ 决策',
        summary: 'TRIZ 来源变更无人类决策日志',
      }),
      priority: 10,
      warnings: [
        {
          code: 'TRIZ_DC_NO_DECISION_LOG',
          message: '缺少可解析的人类决策日志',
        },
      ],
      readiness: 'blocked',
      allowedActions: ['adopt', 'reject', 'view_detail'],
    }),
    fixtureDecisionCenterItem({
      id: 'dc-item-006',
      queueStatus: 'recently_decided',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'contradiction',
        sourceId: 'contra-002',
        sourceHash: 'mno345',
        title: '重量 vs 强度 技术矛盾',
        summary: '已决策：驳回（2026-07-29）',
      }),
      priority: 1,
      relatedDecisionLogIds: [2],
      warnings: [],
      readiness: 'unknown',
      allowedActions: ['view_detail', 'supersede'],
    }),
  ]
}

/** stale 来源队列 */
export function fixtureStaleQueue(): TrizDecisionCenterItem[] {
  return [
    fixtureDecisionCenterItem({
      id: 'dc-stale-001',
      queueStatus: 'stale_source',
      source: fixtureStaleSourceDigest(),
      priority: 9,
      warnings: [fixtureWarning()],
      allowedActions: ['view_detail'],
    }),
  ]
}

/** 无权限队列（模拟用户无权查看时的结果——应为空） */
export function fixtureEmptyQueue(): TrizDecisionCenterItem[] {
  return []
}

/** Draft 阻断队列 */
export function fixtureDraftBlockerQueue(): TrizDecisionCenterItem[] {
  return [
    fixtureDecisionCenterItem({
      id: 'dc-blocker-001',
      queueStatus: 'blocked',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'draft_blocker',
        sourceId: 'blocker-001',
        sourceHash: 'blocker_hash',
        title: 'Draft 阻断：TRIZ 来源变更无决策',
        summary: '变更项引用 TRIZ 矛盾 contra-001 但无对应决策日志',
      }),
      priority: 10,
      warnings: [
        {
          code: 'TRIZ_DC_NO_DECISION_LOG',
          message: '缺少可解析的人类决策日志',
        },
      ],
      readiness: 'blocked',
      allowedActions: ['adopt', 'reject', 'view_detail'],
    }),
  ]
}

/** 近期决策队列 */
export function fixtureRecentDecisionsQueue(): TrizDecisionCenterItem[] {
  return [
    fixtureDecisionCenterItem({
      id: 'dc-recent-001',
      queueStatus: 'recently_decided',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'contradiction',
        sourceId: 'contra-003',
        sourceHash: 'pqr678',
        title: '成本 vs 质量 技术矛盾',
        summary: '已决策：部分采纳（2026-07-30）',
      }),
      priority: 1,
      relatedDecisionLogIds: [3],
    }),
  ]
}

/** AI fallback 队列 */
export function fixtureAiFallbackQueue(): TrizDecisionCenterItem[] {
  return [
    fixtureDecisionCenterItem({
      id: 'dc-fallback-001',
      queueStatus: 'missing_reason',
      source: fixtureVisibleSourceDigest({
        sourceKind: 'recommendation_rationale',
        sourceId: 'rationale-002',
        sourceHash: 'stu901',
        title: '推荐理由：升级缓存层',
        summary: 'AI 理由草稿降级为规则摘要',
      }),
      priority: 5,
      warnings: [
        {
          code: 'TRIZ_DC_AI_FALLBACK',
          message: 'AI 理由草稿不可用，已降级为规则摘要',
        },
      ],
    }),
  ]
}

/** 决策中心摘要 fixture */
export function fixtureDecisionCenterSummary(
  overrides: Partial<TrizDecisionCenterSummary> = {},
): TrizDecisionCenterSummary {
  return {
    queueCounts: {
      pending_decision: 2,
      missing_reason: 1,
      stale_source: 1,
      ready_for_draft: 1,
      blocked: 1,
      recently_decided: 1,
    },
    sourceCounts: {
      contradiction: 2,
      compiler_triz_analysis: 1,
      recommendation_rationale: 1,
      innovation_workbench: 1,
      draft_blocker: 1,
      decision_log: 1,
    },
    warningCounts: {
      TRIZ_DC_MISSING_SOURCE: 0,
      TRIZ_DC_STALE_SOURCE_HASH: 1,
      TRIZ_DC_INACCESSIBLE_TARGET: 0,
      TRIZ_DC_PERMISSION_DENIED: 0,
      TRIZ_DC_AI_FALLBACK: 0,
      TRIZ_DC_NO_DECISION_LOG: 2,
      TRIZ_DC_SOURCE_ERROR: 0,
      TRIZ_DC_CROSS_ORG_REF: 0,
      TRIZ_DC_REASON_TRUNCATED: 0,
    },
    recentKeyDecisions: [],
    totalItems: 7,
    readyForDraftCount: 1,
    blockedCount: 1,
    ...overrides,
  }
}

/** 决策中心详情 fixture */
export function fixtureDecisionCenterDetail(
  overrides: Partial<TrizDecisionCenterDetail> = {},
): TrizDecisionCenterDetail {
  return {
    item: fixtureDecisionCenterItem(),
    evidenceChain: [fixtureVisibleSourceDigest()],
    decisionTimeline: [fixtureTimelineEvent()],
    draftBlockerInfo: null,
    rationaleSummary: '基于矛盾矩阵建议：使用分割原理（#1）或动态化原理（#15）',
    workbenchSchemeSummary: null,
    ...overrides,
  }
}

/** 时间线事件 fixture */
export function fixtureTimelineEvent(
  overrides: Partial<TrizDecisionCenterTimelineEvent> = {},
): TrizDecisionCenterTimelineEvent {
  return {
    id: 1,
    decisionType: 'adopt',
    reasonSummary: '确认采纳：速度优化方案与精度要求可并行满足',
    createdBy: 1,
    createdAt: '2026-07-30T15:00:00.000Z',
    hasAccess: true,
    ...overrides,
  }
}
