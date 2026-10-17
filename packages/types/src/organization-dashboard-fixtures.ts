// @aiproj/types —— 组织级 Dashboard API 示例 fixture（v3-organization-dashboard §2.5）。
//
// 用途：前后端测试复用同一组稳定响应样本，覆盖四类场景——
//   1. 正常（normal）           2. 空组织（empty organization）
//   3. 权限受限（restricted）    4. PMO 不可用（pmo unavailable）
// 全部为确定性常量，不含真实组织数据、证据文本、prompt 或模型输出。

import {
  ORGANIZATION_ATTENTION_REASONS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_VERSION,
  ORGANIZATION_DASHBOARD_SECTION_VALUES,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_REMINDER_CODES,
  ORGANIZATION_DASHBOARD_TARGET_KINDS,
  buildEmptyOrganizationDashboard,
  computeOrganizationAttentionScore,
  degradedOrganizationPmoEntry,
  makeOrganizationDashboardFreshness,
  mergeOrganizationDashboardWarnings,
  normalizeOrganizationDashboardQuery,
  organizationDashboardStableHash,
  redactedOrganizationMemberOverview,
  redactedOrganizationMetric,
  redactedOrganizationResourceOverview,
  redactedOrganizationRiskReminders,
  toOrganizationDistribution,
  type OrganizationDashboardIdentity,
  type OrganizationDashboardSummary,
  type OrganizationPmoEntry,
} from './organization-dashboard.js'

const FIXTURE_CALCULATED_AT = '2026-07-28T00:00:00.000Z'
const FIXTURE_FRESH_UPDATED_AT = '2026-07-28T00:00:00.000Z'
const FIXTURE_STALE_UPDATED_AT = '2026-07-20T00:00:00.000Z'

const FIXTURE_ORGANIZATION: OrganizationDashboardIdentity = {
  organizationId: 1,
  name: '示例组织',
  slug: 'demo-org',
  planTier: 'standard',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function availablePmoEntry(): OrganizationPmoEntry {
  return {
    available: true,
    forbidden: false,
    summary: {
      totalProjects: 12,
      atRiskProjects: 3,
      overallProgressAvg: 58,
    },
    freshness: makeOrganizationDashboardFreshness({
      source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
      lastUpdatedAt: FIXTURE_FRESH_UPDATED_AT,
      now: Date.parse(FIXTURE_CALCULATED_AT),
    }),
    targets: [{ kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.PMO, href: '/pmo', authorized: true }],
    warnings: [],
  }
}

/** 场景 1：正常组织 Dashboard —— 全 section 授权，含 stale 来源与待关注项目。 */
export const ORGANIZATION_DASHBOARD_NORMAL_FIXTURE: OrganizationDashboardSummary = (() => {
  const query = normalizeOrganizationDashboardQuery()
  const pmoEntry = availablePmoEntry()
  const attentionReasons = [
    ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL,
    ORGANIZATION_ATTENTION_REASONS.OVERDUE,
  ]
  const activityFreshness = makeOrganizationDashboardFreshness({
    source: ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
    lastUpdatedAt: FIXTURE_STALE_UPDATED_AT,
    now: Date.parse(FIXTURE_CALCULATED_AT),
  })

  return {
    meta: {
      calculatedAt: FIXTURE_CALCULATED_AT,
      metricVersion: ORGANIZATION_DASHBOARD_METRIC_VERSION,
      organizationId: FIXTURE_ORGANIZATION.organizationId,
      actorId: 10,
      visibleProjectCount: 12,
      sections: [...ORGANIZATION_DASHBOARD_SECTION_VALUES],
      attentionLimit: query.attentionLimit,
      activityLimit: query.activityLimit,
      staleThresholdMinutes: query.freshnessWindowMinutes,
      inputSignatureHash: organizationDashboardStableHash('fixture:normal'),
    },
    organization: FIXTURE_ORGANIZATION,
    kpis: [
      {
        key: ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
        value: 12,
        unit: 'count',
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
      },
      {
        key: ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
        value: 8,
        unit: 'count',
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
      },
      {
        key: ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS,
        value: 3,
        unit: 'count',
        source: ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
      },
      {
        key: ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        value: 58,
        unit: 'percent',
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
      },
    ],
    statusDistribution: toOrganizationDistribution([
      { key: 'active', label: '进行中', count: 8 },
      { key: 'on_hold', label: '暂停', count: 2 },
      { key: 'completed', label: '已完成', count: 2 },
    ]),
    attentionProjects: [
      {
        projectId: 101,
        projectName: '核心平台重构',
        status: 'active',
        healthStatus: 'critical',
        progressPercent: 32,
        attentionScore: computeOrganizationAttentionScore(attentionReasons),
        reasons: [...attentionReasons],
        overdueTaskCount: 4,
        target: {
          kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.PROJECT,
          href: '/projects/101',
          authorized: true,
        },
        warnings: [],
      },
    ],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 24,
      activeMembers: 21,
      roleDistribution: toOrganizationDistribution([
        { key: 'admin', label: '管理员', count: 2 },
        { key: 'member', label: '成员', count: 22 },
      ]),
      target: {
        kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.MEMBER,
        href: '/settings/organization',
        authorized: true,
      },
      warnings: [],
    },
    resourceOverview: {
      available: true,
      forbidden: false,
      allocatedProjectCount: 9,
      overloadedResourceCount: 2,
      totalAllocationPercent: 780,
      target: {
        kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.RESOURCE,
        href: '/resources',
        authorized: true,
      },
      warnings: [],
    },
    riskReminders: [
      {
        code: ORGANIZATION_REMINDER_CODES.HIGH_RISK,
        label: '高风险',
        count: 5,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        target: {
          kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.RISK,
          href: '/risks',
          authorized: true,
        },
        warnings: [],
      },
      {
        code: ORGANIZATION_REMINDER_CODES.OVERDUE_PROJECT,
        label: '已延期项目',
        count: 2,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        target: null,
        warnings: [],
      },
    ],
    recentActivity: [
      {
        id: 9001,
        action: 'project.updated',
        entityType: 'project',
        severity: 'info',
        projectId: 101,
        occurredAt: '2026-07-27T09:30:00.000Z',
        target: {
          kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.PROJECT,
          href: '/projects/101',
          authorized: true,
        },
      },
    ],
    pmoEntry,
    sourceFreshness: [
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        lastUpdatedAt: FIXTURE_FRESH_UPDATED_AT,
        now: Date.parse(FIXTURE_CALCULATED_AT),
      }),
      activityFreshness,
      pmoEntry.freshness!,
    ],
    warnings: mergeOrganizationDashboardWarnings([
      {
        code: 'SOURCE_STALE',
        message: `来源 ${ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG} 数据已超过新鲜度阈值`,
        source: ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
      },
    ]),
  }
})()

/** 场景 2：空组织 —— 零计数、空列表、EMPTY_ORGANIZATION_DASHBOARD warning。 */
export const ORGANIZATION_DASHBOARD_EMPTY_FIXTURE: OrganizationDashboardSummary =
  buildEmptyOrganizationDashboard({
    organization: FIXTURE_ORGANIZATION,
    actorId: 10,
    calculatedAt: FIXTURE_CALCULATED_AT,
  })

/** 场景 3：权限受限 —— 风险/资源/成员维度脱敏，KPI 保留低敏部分。 */
export const ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE: OrganizationDashboardSummary = (() => {
  const base = ORGANIZATION_DASHBOARD_NORMAL_FIXTURE
  const memberOverview = redactedOrganizationMemberOverview()
  const resourceOverview = redactedOrganizationResourceOverview()
  const riskReminders = redactedOrganizationRiskReminders()

  return {
    ...base,
    meta: {
      ...base.meta,
      inputSignatureHash: organizationDashboardStableHash('fixture:restricted'),
    },
    kpis: [
      ...base.kpis.filter(
        (metric) => metric.key !== ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
      ),
      redactedOrganizationMetric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
        ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
      ),
      redactedOrganizationMetric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_COUNT,
        ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
      ),
      redactedOrganizationMetric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
        ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
      ),
    ],
    memberOverview,
    resourceOverview,
    riskReminders,
    recentActivity: [],
    warnings: mergeOrganizationDashboardWarnings(
      memberOverview.warnings,
      resourceOverview.warnings,
      riskReminders.flatMap((reminder) => reminder.warnings),
    ),
  }
})()

/** 场景 4：PMO 摘要不可用 —— 其他授权数据照常返回。 */
export const ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE: OrganizationDashboardSummary = (() => {
  const base = ORGANIZATION_DASHBOARD_NORMAL_FIXTURE
  const pmoEntry = degradedOrganizationPmoEntry('unavailable')
  return {
    ...base,
    meta: {
      ...base.meta,
      inputSignatureHash: organizationDashboardStableHash('fixture:pmo-unavailable'),
    },
    pmoEntry,
    sourceFreshness: [
      ...base.sourceFreshness.filter(
        (item) => item.source !== ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
      ),
      pmoEntry.freshness!,
    ],
    warnings: mergeOrganizationDashboardWarnings(base.warnings, pmoEntry.warnings),
  }
})()

/** fixture 索引——测试按场景名取用。 */
export const ORGANIZATION_DASHBOARD_FIXTURES = {
  normal: ORGANIZATION_DASHBOARD_NORMAL_FIXTURE,
  empty: ORGANIZATION_DASHBOARD_EMPTY_FIXTURE,
  restricted: ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE,
  pmoUnavailable: ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE,
} as const
