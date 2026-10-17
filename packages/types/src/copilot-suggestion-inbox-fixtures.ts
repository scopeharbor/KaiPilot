/**
 * v3-copilot-suggestion-inbox — 八态 fixtures
 *
 * 覆盖：五来源齐全、单来源缺失、去重合并、不合并、过期、已采纳、权限缺失、跨组织排除。
 * 全部使用确定性数据，零网络 / 零 provider。
 */

import type {
  InboxEntry,
  InboxSourceRef,
  InboxMissingSource,
  InboxAggregateResult,
} from './copilot-suggestion-inbox.js'

// ---------------------------------------------------------------------------
// 辅助：确定性 UUID 生成（不依赖外部库）
// ---------------------------------------------------------------------------

let _seq = 0

function fixtureId(prefix: string): string {
  _seq++
  return `${prefix}-${String(_seq).padStart(4, '0')}`
}

/** 重置序列（测试间可选调用） */
export function resetInboxFixtureSeq(): void {
  _seq = 0
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ORG_ID = 'org-fixture-001'
const PROJECT_ID = 'proj-fixture-001'
const NOW = '2026-08-17T10:00:00.000Z'

// ---------------------------------------------------------------------------
// 来源引用工厂
// ---------------------------------------------------------------------------

export function makeSourceRef(
  sourceKind: InboxSourceRef['sourceKind'],
  sourceId: string,
  overrides: Partial<InboxSourceRef> = {},
): InboxSourceRef {
  return {
    sourceKind,
    sourceId,
    projectId: PROJECT_ID,
    sourceHash: `hash-${sourceKind}-${sourceId}`,
    capturedAt: NOW,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 条目工厂
// ---------------------------------------------------------------------------

export function makeInboxEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: fixtureId('entry'),
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    state: 'unread',
    problemKind: 'resource_overload',
    severity: 'high',
    dedupeKey: { problemKind: 'resource_overload', declaredKey: `key-${fixtureId('dk')}` },
    sourceRefs: [makeSourceRef('smart_recommendation', 'rec-001')],
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
// 八态 fixture
// ---------------------------------------------------------------------------

/** 态 1：五来源齐全 —— 所有来源都有引用 */
export function fixtureFiveSourcesComplete(): InboxEntry {
  return makeInboxEntry({
    id: 'entry-five-src',
    problemKind: 'resource_overload',
    severity: 'critical',
    dedupeKey: { problemKind: 'resource_overload', declaredKey: 'five-src-key' },
    sourceRefs: [
      makeSourceRef('smart_recommendation', 'rec-001'),
      makeSourceRef('progress_risk_prediction', 'pred-001'),
      makeSourceRef('risk_ai_suggestion', 'risk-001'),
      makeSourceRef('pmo_priority_recommendation', 'pmo-001'),
      makeSourceRef('health_diagnosis_draft', 'diag-001'),
    ],
    state: 'unread',
  })
}

/** 态 2：单来源缺失 —— 只有两个来源，其余未聚合 */
export function fixtureSingleSourceMissing(): {
  entry: InboxEntry
  missing: InboxMissingSource[]
} {
  return {
    entry: makeInboxEntry({
      id: 'entry-partial',
      problemKind: 'schedule_risk',
      severity: 'high',
      dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'partial-key' },
      sourceRefs: [
        makeSourceRef('smart_recommendation', 'rec-002'),
        makeSourceRef('progress_risk_prediction', 'pred-002'),
      ],
    }),
    missing: [
      {
        sourceKind: 'risk_ai_suggestion',
        reason: '来源查询超时',
      },
      {
        sourceKind: 'pmo_priority_recommendation',
        reason: '来源服务不可用',
      },
      {
        sourceKind: 'health_diagnosis_draft',
        reason: '来源查询失败',
      },
    ],
  }
}

/** 态 3：去重合并 —— 两个来源报同一问题，合并为一条 */
export function fixtureDedupeMerge(): InboxEntry[] {
  return [
    makeInboxEntry({
      id: 'entry-merged',
      problemKind: 'resource_overload',
      severity: 'high',
      dedupeKey: { problemKind: 'resource_overload', declaredKey: 'overload-proj-x' },
      sourceRefs: [
        makeSourceRef('smart_recommendation', 'rec-010'),
        makeSourceRef('progress_risk_prediction', 'pred-010'),
      ],
    }),
  ]
}

/** 态 4：不合并 —— 两个不同问题，保持分开 */
export function fixtureDedupeNoMerge(): InboxEntry[] {
  return [
    makeInboxEntry({
      id: 'entry-no-merge-1',
      problemKind: 'resource_overload',
      severity: 'high',
      dedupeKey: { problemKind: 'resource_overload', declaredKey: 'key-a' },
      sourceRefs: [makeSourceRef('smart_recommendation', 'rec-020')],
    }),
    makeInboxEntry({
      id: 'entry-no-merge-2',
      problemKind: 'schedule_risk',
      severity: 'medium',
      dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'key-b' },
      sourceRefs: [makeSourceRef('progress_risk_prediction', 'pred-020')],
    }),
  ]
}

/** 态 5：已过期 —— source hash 失配，带原因 */
export function fixtureExpired(): InboxEntry {
  return makeInboxEntry({
    id: 'entry-expired',
    state: 'expired',
    problemKind: 'schedule_risk',
    severity: 'medium',
    dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'expired-key' },
    sourceRefs: [
      makeSourceRef('progress_risk_prediction', 'pred-030', {
        sourceHash: 'old-hash-does-not-match',
      }),
    ],
    expiryReason: 'schedule_changed',
    expiryDetail: '该建议依赖的排期已变更',
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
  })
}

/** 态 6：已采纳 —— 用户显式采纳 */
export function fixtureAdopted(): InboxEntry {
  return makeInboxEntry({
    id: 'entry-adopted',
    state: 'adopted',
    problemKind: 'resource_overload',
    severity: 'critical',
    dedupeKey: { problemKind: 'resource_overload', declaredKey: 'adopted-key' },
    sourceRefs: [
      makeSourceRef('smart_recommendation', 'rec-040'),
      makeSourceRef('risk_ai_suggestion', 'risk-040'),
    ],
    readAt: '2026-08-16T14:00:00.000Z',
    actionedAt: '2026-08-16T14:30:00.000Z',
  })
}

/** 态 7：权限缺失 —— actor 不可访问该来源，条目不出现在结果中 */
export const fixturePermissionMissing = {
  entry: makeInboxEntry({
    id: 'entry-perm-missing',
    problemKind: 'risk_escalation',
    severity: 'high',
    dedupeKey: { problemKind: 'risk_escalation', declaredKey: 'perm-key' },
    sourceRefs: [makeSourceRef('pmo_priority_recommendation', 'pmo-050')],
  }),
  /** 该 actor 没有 pmo_priority_recommendation 的查看权限 */
  actorPermissionMissing: 'pmo_priority_recommendation' as const,
}

/** 态 8：跨组织排除 —— 不同 organizationId 的条目恒不出现 */
export const fixtureCrossOrgExclusion = {
  otherOrgEntry: makeInboxEntry({
    id: 'entry-other-org',
    organizationId: 'org-other-999',
    problemKind: 'process_gap',
    severity: 'medium',
    dedupeKey: { problemKind: 'process_gap', declaredKey: 'cross-org-key' },
    sourceRefs: [makeSourceRef('smart_recommendation', 'rec-060')],
  }),
  targetOrgId: ORG_ID,
}

// ---------------------------------------------------------------------------
// 聚合结果工厂
// ---------------------------------------------------------------------------

export function makeAggregateResult(
  entries: InboxEntry[],
  overrides: Partial<InboxAggregateResult> = {},
): InboxAggregateResult {
  const unreadCount = entries.filter((e) => e.state === 'unread').length
  return {
    entries,
    total: entries.length,
    unreadCount,
    missingSources: [],
    pagination: { page: 1, perPage: 20, totalPages: 1 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 确定性排序测试数据
// ---------------------------------------------------------------------------

export function fixtureDeterministicOrder(): InboxEntry[] {
  return [
    makeInboxEntry({
      id: 'order-003',
      severity: 'medium',
      createdAt: '2026-08-15T10:00:00.000Z',
      problemKind: 'data_staleness',
      dedupeKey: { problemKind: 'data_staleness', declaredKey: 'dk-3' },
      sourceRefs: [makeSourceRef('smart_recommendation', 'rec-o3')],
    }),
    makeInboxEntry({
      id: 'order-001',
      severity: 'critical',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'resource_overload',
      dedupeKey: { problemKind: 'resource_overload', declaredKey: 'dk-1' },
      sourceRefs: [makeSourceRef('smart_recommendation', 'rec-o1')],
    }),
    makeInboxEntry({
      id: 'order-002',
      severity: 'critical',
      createdAt: '2026-08-16T10:00:00.000Z',
      problemKind: 'schedule_risk',
      dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'dk-2' },
      sourceRefs: [makeSourceRef('progress_risk_prediction', 'pred-o2')],
    }),
    makeInboxEntry({
      id: 'order-004',
      severity: 'low',
      createdAt: '2026-08-17T10:00:00.000Z',
      problemKind: 'process_gap',
      dedupeKey: { problemKind: 'process_gap', declaredKey: 'dk-4' },
      sourceRefs: [makeSourceRef('health_diagnosis_draft', 'diag-o4')],
    }),
  ]
}

/** 预期排序：order-001（critical, newer）→ order-002（critical, older）→ order-003（medium）→ order-004（low） */
export const EXPECTED_DETERMINISTIC_ORDER = ['order-001', 'order-002', 'order-003', 'order-004']
