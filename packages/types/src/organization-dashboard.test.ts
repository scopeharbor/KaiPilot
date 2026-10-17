import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_ATTENTION_REASONS,
  ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
  ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT,
  ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT,
  ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES,
  ORGANIZATION_DASHBOARD_METRIC_VERSION,
  ORGANIZATION_DASHBOARD_SECTION_VALUES,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_SOURCE_VALUES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_DASHBOARD_WARNING_CODES,
  ORGANIZATION_DASHBOARD_WARNING_CODE_VALUES,
  buildEmptyOrganizationDashboard,
  computeOrganizationAttentionScore,
  degradedOrganizationPmoEntry,
  isOrganizationDashboardSourceStale,
  isUnsupportedFinancialField,
  makeOrganizationDashboardFreshness,
  mergeOrganizationDashboardWarnings,
  normalizeOrganizationDashboardQuery,
  organizationDashboardFreshnessHash,
  organizationDashboardStableHash,
  organizationDashboardValidationDetail,
  organizationFinancialUnsupportedWarning,
  redactedOrganizationMemberOverview,
  redactedOrganizationMetric,
  redactedOrganizationResourceOverview,
  redactedOrganizationRiskReminders,
  toOrganizationDistribution,
  type OrganizationDashboardIdentity,
} from './organization-dashboard.js'
import {
  ORGANIZATION_DASHBOARD_EMPTY_FIXTURE,
  ORGANIZATION_DASHBOARD_FIXTURES,
  ORGANIZATION_DASHBOARD_NORMAL_FIXTURE,
  ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE,
  ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE,
} from './organization-dashboard-fixtures.js'

const ORGANIZATION: OrganizationDashboardIdentity = {
  organizationId: 7,
  name: '测试组织',
  slug: 'test-org',
  planTier: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('组织 Dashboard —— 稳定契约键位', () => {
  it('metric key 集合稳定（破坏性变更必须显式失败）', () => {
    expect([...ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES].sort()).toEqual(
      [
        'org_active_member_total',
        'org_active_projects',
        'org_archived_projects',
        'org_attention_projects',
        'org_completed_projects',
        'org_due_soon_projects',
        'org_high_risk_count',
        'org_member_total',
        'org_on_hold_projects',
        'org_open_risk_count',
        'org_overall_progress_avg',
        'org_overdue_projects',
        'org_recent_activity_count',
        'org_resource_allocated_projects',
        'org_resource_overload_count',
        'org_stale_source_count',
        'org_total_projects',
      ].sort(),
    )
  })

  it('warning code 集合稳定且包含规范强制的三个码', () => {
    expect([...ORGANIZATION_DASHBOARD_WARNING_CODE_VALUES].sort()).toEqual(
      [
        'CACHE_DEGRADED',
        'EMPTY_ORGANIZATION_DASHBOARD',
        'FINANCIAL_UNSUPPORTED',
        'PERMISSION_REDACTED',
        'PMO_SUMMARY_FORBIDDEN',
        'PMO_SUMMARY_UNAVAILABLE',
        'SOURCE_PARTIAL',
        'SOURCE_STALE',
        'SOURCE_UNAVAILABLE',
      ].sort(),
    )
    expect(ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD).toBe(
      'EMPTY_ORGANIZATION_DASHBOARD',
    )
    expect(ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_FORBIDDEN).toBe('PMO_SUMMARY_FORBIDDEN')
    expect(ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_UNAVAILABLE).toBe(
      'PMO_SUMMARY_UNAVAILABLE',
    )
  })

  it('source identifier 与 section 白名单稳定', () => {
    expect([...ORGANIZATION_DASHBOARD_SOURCE_VALUES].sort()).toEqual(
      [
        'activity_log',
        'computed',
        'membership',
        'organization',
        'pmo_portfolio',
        'project',
        'project_dashboard',
        'resource_summary',
        'risk_summary',
      ].sort(),
    )
    expect([...ORGANIZATION_DASHBOARD_SECTION_VALUES]).toEqual([
      'identity',
      'kpi',
      'status_distribution',
      'attention_projects',
      'member_overview',
      'resource_overview',
      'risk_reminders',
      'activity',
      'pmo_entry',
    ])
  })

  it('metric version 固定为 organization-dashboard.v1', () => {
    expect(ORGANIZATION_DASHBOARD_METRIC_VERSION).toBe('organization-dashboard.v1')
  })
})

describe('组织 Dashboard —— 查询归一化与边界', () => {
  it('默认返回全部 section 与默认 limit', () => {
    const query = normalizeOrganizationDashboardQuery()
    expect(query.sections).toEqual([...ORGANIZATION_DASHBOARD_SECTION_VALUES])
    expect(query.attentionLimit).toBe(5)
    expect(query.activityLimit).toBe(10)
    expect(query.attentionSort).toBe('attention_score')
    expect(query.attentionOrder).toBe('desc')
  })

  it('超限 limit 被 clamp 到上限，非法值回落到下限', () => {
    const clamped = normalizeOrganizationDashboardQuery({
      attentionLimit: 999,
      activityLimit: 999,
      freshnessWindowMinutes: 999_999,
      dueSoonDays: 999,
    })
    expect(clamped.attentionLimit).toBe(ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT)
    expect(clamped.activityLimit).toBe(ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT)
    expect(clamped.freshnessWindowMinutes).toBe(ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES)
    expect(clamped.dueSoonDays).toBe(30)

    const invalid = normalizeOrganizationDashboardQuery({
      attentionLimit: Number.NaN,
      activityLimit: -10,
    })
    expect(invalid.attentionLimit).toBe(1)
    expect(invalid.activityLimit).toBe(1)
  })

  it('未知 section 被过滤，保留白名单顺序且去重', () => {
    const query = normalizeOrganizationDashboardQuery({
      sections: ['activity', 'kpi', 'kpi', 'secret_section' as never],
    })
    expect(query.sections).toEqual(['kpi', 'activity'])
  })

  it('search 被截断到最大长度并 trim', () => {
    const query = normalizeOrganizationDashboardQuery({ search: `  ${'x'.repeat(500)}  ` })
    expect(query.search).toHaveLength(200)
  })

  it('校验 detail 只暴露允许值，不含组织内部事实', () => {
    const detail = organizationDashboardValidationDetail()
    expect(detail.allowedSections).toEqual(ORGANIZATION_DASHBOARD_SECTION_VALUES)
    expect(detail.allowedAttentionSorts).toEqual(ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES)
    expect(detail.maxAttentionLimit).toBe(ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT)
    expect(JSON.stringify(detail)).not.toMatch(/organizationId|projectName/)
  })
})

describe('组织 Dashboard —— freshness / stale', () => {
  const now = Date.parse('2026-07-28T00:00:00.000Z')

  it('null lastUpdatedAt 视为 stale', () => {
    expect(isOrganizationDashboardSourceStale(null, 60, now)).toBe(true)
  })

  it('超阈值标记 stale，阈值内标记 ok', () => {
    expect(isOrganizationDashboardSourceStale('2026-07-27T00:00:00.000Z', 60, now)).toBe(true)
    expect(isOrganizationDashboardSourceStale('2026-07-27T23:30:00.000Z', 60, now)).toBe(false)
  })

  it('forbidden / unavailable 来源不冒充 stale', () => {
    const forbidden = makeOrganizationDashboardFreshness({
      source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
      lastUpdatedAt: null,
      forbidden: true,
    })
    expect(forbidden.status).toBe(ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN)
    expect(forbidden.isStale).toBe(false)

    const unavailable = makeOrganizationDashboardFreshness({
      source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
      lastUpdatedAt: null,
      unavailable: true,
    })
    expect(unavailable.status).toBe(ORGANIZATION_DASHBOARD_STATUSES.UNAVAILABLE)
  })

  it('freshness hash 稳定且不含业务事实', () => {
    const freshness = makeOrganizationDashboardFreshness({
      source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
      lastUpdatedAt: '2026-07-28T00:00:00.000Z',
      now,
    })
    const hash = organizationDashboardFreshnessHash(freshness)
    expect(hash).toBe(organizationDashboardFreshnessHash(freshness))
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('stable hash 对相同输入确定，对不同输入不同', () => {
    expect(organizationDashboardStableHash('a')).toBe(organizationDashboardStableHash('a'))
    expect(organizationDashboardStableHash('a')).not.toBe(organizationDashboardStableHash('b'))
  })
})

describe('组织 Dashboard —— 空 / forbidden / unavailable 状态', () => {
  it('空组织返回零计数、空列表与 EMPTY_ORGANIZATION_DASHBOARD warning', () => {
    const empty = buildEmptyOrganizationDashboard({
      organization: ORGANIZATION,
      actorId: 3,
      calculatedAt: '2026-07-28T00:00:00.000Z',
    })
    expect(empty.meta.visibleProjectCount).toBe(0)
    expect(empty.attentionProjects).toEqual([])
    expect(empty.recentActivity).toEqual([])
    expect(empty.riskReminders).toEqual([])
    expect(empty.kpis.every((metric) => metric.value === 0)).toBe(true)
    expect(
      empty.kpis.every((metric) => metric.status === ORGANIZATION_DASHBOARD_STATUSES.EMPTY),
    ).toBe(true)
    expect(empty.warnings.map((warning) => warning.code)).toContain('EMPTY_ORGANIZATION_DASHBOARD')
  })

  it('空组织不伪造健康 / 风险 / 资源 / PMO 数值', () => {
    const empty = ORGANIZATION_DASHBOARD_EMPTY_FIXTURE
    expect(empty.pmoEntry.summary).toBeNull()
    expect(empty.pmoEntry.available).toBe(false)
    expect(empty.resourceOverview.overloadedResourceCount).toBe(0)
    expect(empty.statusDistribution).toEqual([])
  })

  it('权限受限投影只返回 null 值与低敏 warning', () => {
    const metric = redactedOrganizationMetric(
      ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
      ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
    )
    expect(metric.value).toBeNull()
    expect(metric.status).toBe(ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN)
    expect(metric.warnings?.[0]?.code).toBe('PERMISSION_REDACTED')

    const member = redactedOrganizationMemberOverview()
    expect(member.totalMembers).toBeNull()
    expect(member.roleDistribution).toEqual([])
    expect(member.target).toBeNull()

    const resource = redactedOrganizationResourceOverview()
    expect(resource.allocatedProjectCount).toBeNull()
    expect(resource.totalAllocationPercent).toBeNull()

    const reminders = redactedOrganizationRiskReminders()
    expect(reminders.every((reminder) => reminder.count === null)).toBe(true)
    expect(reminders.every((reminder) => reminder.target === null)).toBe(true)
  })

  it('PMO forbidden / unavailable 各自返回对应 warning 且不带 summary', () => {
    const forbidden = degradedOrganizationPmoEntry('forbidden')
    expect(forbidden.forbidden).toBe(true)
    expect(forbidden.summary).toBeNull()
    expect(forbidden.targets).toEqual([])
    expect(forbidden.warnings[0]?.code).toBe('PMO_SUMMARY_FORBIDDEN')

    const unavailable = degradedOrganizationPmoEntry('unavailable')
    expect(unavailable.forbidden).toBe(false)
    expect(unavailable.warnings[0]?.code).toBe('PMO_SUMMARY_UNAVAILABLE')
  })

  it('财务字段只返回 unsupported warning，不产生数值', () => {
    expect(isUnsupportedFinancialField('roi')).toBe(true)
    expect(isUnsupportedFinancialField('progress')).toBe(false)
    const warning = organizationFinancialUnsupportedWarning('budget')
    expect(warning.code).toBe('FINANCIAL_UNSUPPORTED')
    expect(warning).not.toHaveProperty('value')
  })
})

describe('组织 Dashboard —— 纯函数助手', () => {
  it('warning 合并按 code+source+metricKey 去重且保持顺序', () => {
    const merged = mergeOrganizationDashboardWarnings(
      [organizationFinancialUnsupportedWarning('roi')],
      [organizationFinancialUnsupportedWarning('roi')],
      [
        {
          code: ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_STALE,
          message: 'x',
          source: ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
        },
      ],
    )
    expect(merged).toHaveLength(2)
    expect(merged[0]?.code).toBe('FINANCIAL_UNSUPPORTED')
  })

  it('attention 分数确定且封顶 100', () => {
    expect(
      computeOrganizationAttentionScore([ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL]),
    ).toBe(40)
    expect(
      computeOrganizationAttentionScore([
        ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL,
        ORGANIZATION_ATTENTION_REASONS.OVERDUE,
        ORGANIZATION_ATTENTION_REASONS.HEALTH_AT_RISK,
        ORGANIZATION_ATTENTION_REASONS.DUE_SOON,
        ORGANIZATION_ATTENTION_REASONS.ON_HOLD,
        ORGANIZATION_ATTENTION_REASONS.NO_PROGRESS,
      ]),
    ).toBe(100)
    expect(computeOrganizationAttentionScore([])).toBe(0)
  })

  it('分布百分比合计为 100，空输入返回全 0', () => {
    const slices = toOrganizationDistribution([
      { key: 'a', label: 'A', count: 1 },
      { key: 'b', label: 'B', count: 1 },
      { key: 'c', label: 'C', count: 1 },
    ])
    expect(slices.reduce((sum, slice) => sum + slice.percent, 0)).toBeCloseTo(100, 5)

    const zero = toOrganizationDistribution([{ key: 'a', label: 'A', count: 0 }])
    expect(zero[0]?.percent).toBe(0)
  })
})

describe('组织 Dashboard —— API fixture', () => {
  it('四类 fixture 齐备且 metricVersion 一致', () => {
    expect(Object.keys(ORGANIZATION_DASHBOARD_FIXTURES).sort()).toEqual([
      'empty',
      'normal',
      'pmoUnavailable',
      'restricted',
    ])
    for (const fixture of Object.values(ORGANIZATION_DASHBOARD_FIXTURES)) {
      expect(fixture.meta.metricVersion).toBe(ORGANIZATION_DASHBOARD_METRIC_VERSION)
      expect(fixture.organization.organizationId).toBe(1)
    }
  })

  it('normal fixture 含 stale 来源与授权 target', () => {
    const normal = ORGANIZATION_DASHBOARD_NORMAL_FIXTURE
    expect(normal.sourceFreshness.some((item) => item.isStale)).toBe(true)
    expect(normal.warnings.some((warning) => warning.code === 'SOURCE_STALE')).toBe(true)
    expect(normal.attentionProjects[0]?.target?.authorized).toBe(true)
    expect(normal.pmoEntry.available).toBe(true)
  })

  it('restricted fixture 不泄露隐藏计数、名称或 target', () => {
    const restricted = ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE
    expect(restricted.memberOverview.totalMembers).toBeNull()
    expect(restricted.resourceOverview.overloadedResourceCount).toBeNull()
    expect(restricted.riskReminders.every((reminder) => reminder.count === null)).toBe(true)
    expect(restricted.recentActivity).toEqual([])
    expect(restricted.warnings.every((warning) => warning.code === 'PERMISSION_REDACTED')).toBe(
      true,
    )
  })

  it('pmoUnavailable fixture 保留其余授权数据', () => {
    const fixture = ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE
    expect(fixture.pmoEntry.available).toBe(false)
    expect(fixture.pmoEntry.summary).toBeNull()
    expect(fixture.warnings.some((warning) => warning.code === 'PMO_SUMMARY_UNAVAILABLE')).toBe(
      true,
    )
    expect(fixture.kpis.length).toBeGreaterThan(0)
    expect(fixture.attentionProjects.length).toBeGreaterThan(0)
  })

  it('所有 fixture 不含证据文本 / prompt / token 字段', () => {
    const serialized = JSON.stringify(ORGANIZATION_DASHBOARD_FIXTURES)
    expect(serialized).not.toMatch(/prompt|accessToken|Authorization|apiKey|evidenceText/i)
  })
})
