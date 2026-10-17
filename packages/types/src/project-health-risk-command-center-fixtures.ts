// @aiproj/types —— 项目健康风险指挥中心确定性 fixtures。
// v3-project-health-risk-command-center §2.11：ready/empty/stale/partial/
// forbidden/conflict/large-project 七类场景的确定性投影输入与期望输出，
// 全部时间显式注入、零真实 provider/网络依赖。

import {
  COMMAND_CENTER_AVAILABILITIES,
  COMMAND_CENTER_CONTRACT_VERSION,
  COMMAND_CENTER_EVIDENCE_CLASSES,
  COMMAND_CENTER_FRESHNESS_STATES,
  COMMAND_CENTER_REASON_CODES,
  COMMAND_CENTER_SEVERITIES,
  COMMAND_CENTER_SOURCES,
  COMMAND_CENTER_TARGET_KINDS,
  canonicalizeCommandCenterQuery,
  computeCommandCenterPermissionFingerprint,
  computeProjectionSignature,
  detectSourcePostureConflict,
  normalizeCommandCenterQuery,
  projectAttentionQueue,
  resolveHeadline,
  setCommandCenterNow,
} from './project-health-risk-command-center.js'
import type {
  CommandCenterAttentionCandidate,
  CommandCenterResponse,
  HealthDiagnosisCommandCenterFacts,
  ProjectDashboardCommandCenterFacts,
  RiskWorkbenchCommandCenterFacts,
} from './project-health-risk-command-center.js'

/** fixtures 固定参考时间（2026-09-01T08:00:00Z）。 */
export const COMMAND_CENTER_FIXTURE_NOW_MS = Date.parse('2026-09-01T08:00:00.000Z')

const FIXED_PERMISSION_FINGERPRINT = computeCommandCenterPermissionFingerprint([
  'project:view',
  'risk:view',
])

function baseQuery() {
  const normalized = normalizeCommandCenterQuery({ attentionLimit: 20 })
  if (!normalized.ok) throw new Error('fixture query must normalize')
  return normalized.query
}

// ─── 基础 facts 构造 ───────────────────────────────────────────────────────────

export function fixtureDashboardFacts(
  overrides: Partial<ProjectDashboardCommandCenterFacts> = {},
): ProjectDashboardCommandCenterFacts {
  return {
    sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
    healthStatus: 'yellow',
    progressPercent: 42,
    memberCount: 6,
    remainingDays: 30,
    metricVersion: 'dashboard-metrics.v1',
    ...overrides,
  }
}

export function fixtureDiagnosisFacts(
  overrides: Partial<HealthDiagnosisCommandCenterFacts> = {},
): HealthDiagnosisCommandCenterFacts {
  return {
    sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
    diagnosisId: 9001,
    overallScore: 86,
    overallLabel: '良好',
    status: 'confirmed',
    stale: false,
    confirmedAt: '2026-08-30T10:00:00.000Z',
    dimensionScores: [
      { dimension: 'schedule', score: 82, severity: COMMAND_CENTER_SEVERITIES.MEDIUM },
      { dimension: 'risk', score: 90, severity: COMMAND_CENTER_SEVERITIES.INFO },
    ],
    ...overrides,
  }
}

export function fixtureRiskFacts(
  overrides: Partial<RiskWorkbenchCommandCenterFacts> = {},
): RiskWorkbenchCommandCenterFacts {
  return {
    sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
    totalRisks: 12,
    openRisks: 5,
    highRiskCount: 2,
    criticalRiskCount: 0,
    overdueReviewCount: 1,
    incompleteResponsePlans: 2,
    healthScore: 74,
    trend30d: { created: 4, closed: 3 },
    ...overrides,
  }
}

// ─── 场景 fixtures ─────────────────────────────────────────────────────────────

export interface FixtureScenario {
  name: 'ready' | 'empty' | 'stale' | 'partial' | 'forbidden' | 'conflict' | 'large-project'
  nowMs: number
  query: ReturnType<typeof baseQuery>
  permissionFingerprint: string
  attentionCandidates: CommandCenterAttentionCandidate[]
}

/** ready：已确认且 current 的诊断 + 正常风险。 */
export function fixtureReady(): FixtureScenario {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  return {
    name: 'ready',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: [],
  }
}

/** empty：无已确认诊断（headline 回退 Dashboard + MISSING warning）、无风险。 */
export function fixtureEmpty(): FixtureScenario {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  return {
    name: 'empty',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: [],
  }
}

/** stale：诊断存在但过期（freshness=stale，headline 回退 + STALE warning + 复核 attention）。 */
export function fixtureStale(): FixtureScenario {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  return {
    name: 'stale',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: [
      {
        sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
        kind: 'source-stale-review',
        severity: COMMAND_CENTER_SEVERITIES.MEDIUM,
        reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_STALE_REVIEW_REQUIRED,
        entityRef: { kind: 'diagnosis', id: 9001 },
        label: '健康诊断需要刷新复核',
        occurredAt: '2026-08-20T10:00:00.000Z',
        dueAt: null,
        stale: true,
        targets: [
          {
            kind: COMMAND_CENTER_TARGET_KINDS.HEALTH_EVIDENCE,
            params: { projectId: 101, diagnosisId: 9001 },
          },
        ],
      },
    ],
  }
}

/** partial：预测来源 unavailable（reader 失败），其余可用。 */
export function fixturePartial(): FixtureScenario {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  return {
    name: 'partial',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: [
      {
        sourceKey: COMMAND_CENTER_SOURCES.PREDICTION,
        kind: 'source-unavailable',
        severity: COMMAND_CENTER_SEVERITIES.LOW,
        reasonCode: COMMAND_CENTER_REASON_CODES.SOURCE_UNAVAILABLE,
        entityRef: null,
        label: '预测来源暂不可用',
        occurredAt: null,
        dueAt: null,
        stale: false,
        targets: [],
      },
    ],
  }
}

/** forbidden：无 risk:view——风险来源整体缺席（不携带任何事实）。 */
export function fixtureForbidden(): FixtureScenario {
  return {
    name: 'forbidden',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: computeCommandCenterPermissionFingerprint(['project:view']),
    attentionCandidates: [],
  }
}

/** conflict：headline green 但风险工作台有高/严重开放风险。 */
export function fixtureConflict(): FixtureScenario {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  const headline = resolveHeadline({
    dashboard: {
      meta: {
        sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
        evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
        availability: COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
        freshness: COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
        authorityRef: null,
        sourceVersionDigest: null,
        calculatedAt: '2026-09-01T08:00:00.000Z',
        reasonCode: null,
      },
      facts: fixtureDashboardFacts({ healthStatus: 'green' }),
    },
    diagnosis: null,
  })
  const conflict = detectSourcePostureConflict(headline, fixtureRiskFacts())
  if (!conflict) throw new Error('conflict fixture must produce SOURCE_POSTURE_CONFLICT')
  return {
    name: 'conflict',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: baseQuery(),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: [
      {
        sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
        kind: 'high-risk-open',
        severity: COMMAND_CENTER_SEVERITIES.CRITICAL,
        reasonCode: COMMAND_CENTER_REASON_CODES.HIGH_SEVERITY_RISK_OPEN,
        entityRef: { kind: 'risk', id: 501 },
        label: '严重风险待处理',
        occurredAt: '2026-08-28T09:00:00.000Z',
        dueAt: null,
        stale: false,
        targets: [
          {
            kind: COMMAND_CENTER_TARGET_KINDS.RISK_DETAIL,
            params: { projectId: 101, riskId: 501 },
          },
        ],
      },
    ],
  }
}

/**
 * large-project：1000 任务 / 2000 依赖 / 100 风险等效压力下的注意力候选
 * （120 条 → limit=100 截断 20 条）。确定性生成：id 与时间均为公式化。
 */
export function fixtureLargeProject(): FixtureScenario & {
  taskCount: number
  dependencyCount: number
  riskCount: number
} {
  setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
  const candidates: CommandCenterAttentionCandidate[] = []
  for (let i = 0; i < 100; i++) {
    candidates.push({
      sourceKey: COMMAND_CENTER_SOURCES.TASK_MILESTONE,
      kind: 'task-overdue',
      severity: i % 5 === 0 ? COMMAND_CENTER_SEVERITIES.HIGH : COMMAND_CENTER_SEVERITIES.MEDIUM,
      reasonCode: COMMAND_CENTER_REASON_CODES.TASK_OVERDUE,
      entityRef: { kind: 'task', id: 7000 + i },
      label: `任务 ${7000 + i} 已逾期`,
      occurredAt: new Date(COMMAND_CENTER_FIXTURE_NOW_MS - (i + 1) * 86_400_000).toISOString(),
      dueAt: new Date(COMMAND_CENTER_FIXTURE_NOW_MS - (i % 7) * 86_400_000).toISOString(),
      stale: false,
      targets: [
        {
          kind: COMMAND_CENTER_TARGET_KINDS.TASK_DETAIL,
          params: { projectId: 101, taskId: 7000 + i },
        },
      ],
    })
  }
  for (let i = 0; i < 20; i++) {
    candidates.push({
      sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
      kind: 'risk-review-overdue',
      severity: i < 4 ? COMMAND_CENTER_SEVERITIES.CRITICAL : COMMAND_CENTER_SEVERITIES.HIGH,
      reasonCode: COMMAND_CENTER_REASON_CODES.RISK_REVIEW_OVERDUE,
      entityRef: { kind: 'risk', id: 8000 + i },
      label: `风险 ${8000 + i} 复查逾期`,
      occurredAt: new Date(COMMAND_CENTER_FIXTURE_NOW_MS - (i + 2) * 86_400_000).toISOString(),
      dueAt: new Date(COMMAND_CENTER_FIXTURE_NOW_MS - (i % 5) * 86_400_000).toISOString(),
      stale: false,
      targets: [
        {
          kind: COMMAND_CENTER_TARGET_KINDS.RISK_DETAIL,
          params: { projectId: 101, riskId: 8000 + i },
        },
      ],
    })
  }
  return {
    name: 'large-project',
    nowMs: COMMAND_CENTER_FIXTURE_NOW_MS,
    query: normalizeOrThrow({ attentionLimit: 100 }),
    permissionFingerprint: FIXED_PERMISSION_FINGERPRINT,
    attentionCandidates: candidates,
    taskCount: 1000,
    dependencyCount: 2000,
    riskCount: 100,
  }
}

function normalizeOrThrow(q: Parameters<typeof normalizeCommandCenterQuery>[0]) {
  const r = normalizeCommandCenterQuery(q)
  if (!r.ok) throw new Error('fixture query must normalize')
  return r.query
}

/** 场景注册表：按名字取用。 */
export const COMMAND_CENTER_FIXTURE_SCENARIOS = {
  ready: fixtureReady,
  empty: fixtureEmpty,
  stale: fixtureStale,
  partial: fixturePartial,
  forbidden: fixtureForbidden,
  conflict: fixtureConflict,
  'large-project': fixtureLargeProject,
} as const

/** 投影签名快照基线：同场景恒同签名（序列化兼容性锚点）。 */
export function fixtureProjectionSignature(scenario: FixtureScenario): string {
  return computeProjectionSignature({
    permissionFingerprint: scenario.permissionFingerprint,
    query: scenario.query,
    sources: [
      {
        sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
        evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
        availability: COMMAND_CENTER_AVAILABILITIES.AVAILABLE,
        freshness: COMMAND_CENTER_FRESHNESS_STATES.CURRENT,
        reasonCode: null,
        sourceVersionDigest: 'dashboard-metrics.v1',
      },
    ],
  })
}

/** 空响应骨架（供后端/前端测试对齐 envelope 形态）。 */
export function fixtureEmptyResponseSkeleton(projectId = 101): CommandCenterResponse['data'] {
  return {
    project: { id: projectId, organizationId: 1 },
    headline: resolveHeadline({ diagnosis: null }),
    sources: [],
    attention: projectAttentionQueue([], 20).items,
  }
}

export const FIXTURE_CONTRACT_VERSION: typeof COMMAND_CENTER_CONTRACT_VERSION =
  COMMAND_CENTER_CONTRACT_VERSION

export const FIXTURE_CANONICAL_QUERY_READY = canonicalizeCommandCenterQuery(baseQuery())
