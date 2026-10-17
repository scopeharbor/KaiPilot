/**
 * v3-ui-next-org-portfolio-domains W1 · tasks 1.2 —— 组织概览适配器单元测试
 * （spec「组织概览工作台与指标级脱敏」呈现语义）。
 *
 * 覆盖：受限指标布尔判定与「不可见」中性文案、KPI 数值/百分比/受限占位格式化
 * 边界、状态/提醒/来源/关注原因中文标签映射、相对时间（刚刚/N 分钟前/N 小时前/
 * N 天前/未知）与 stale 来源判定、KPI 条缺省选区与空组织判定。
 * 零 DOM 高速单测（无 React 依赖）。
 */
import { describe, expect, test } from 'vitest'
import {
  ORGANIZATION_ATTENTION_REASON_VALUES,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_DASHBOARD_WARNING_CODES,
  ORGANIZATION_REMINDER_CODES,
  type OrganizationAttentionItem,
  type OrganizationDashboardDistributionSlice,
  type OrganizationDashboardMetric,
  type OrganizationDashboardSourceFreshness,
  type OrganizationDashboardSummary,
  type OrganizationMemberOverview,
  type OrganizationPmoEntry,
  type OrganizationResourceOverview,
  type OrganizationRiskReminder,
  type OrganizationDashboardWarning,
} from '@aiproj/types'
import {
  ORG_OVERVIEW_REDACTED_HINT,
  ORG_OVERVIEW_REDACTED_TEXT,
  ORGANIZATION_ATTENTION_REASON_LABELS,
  ORGANIZATION_HEALTH_LABELS,
  ORGANIZATION_METRIC_LABELS,
  ORGANIZATION_PROJECT_STATUS_LABELS,
  ORGANIZATION_REMINDER_LABELS,
  ORGANIZATION_SOURCE_LABELS,
  ORGANIZATION_WARNING_LABELS,
  ORGANIZATION_KPI_STRIP_ORDER,
  formatOrganizationMetricValue,
  formatOrganizationWarning,
  formatRelativeTime,
  isEmptyOrganizationDashboard,
  isMetricRedacted,
  selectKpiStrip,
  staleSources,
} from '@/lib/next/org-overview/org-overview-adapter'

// ─── 夹具构造 ─────────────────────────────────────────────────────────────────

function makeMetric(
  key: OrganizationDashboardMetric['key'],
  value: number | null,
  unit: OrganizationDashboardMetric['unit'] = 'count',
  status: OrganizationDashboardMetric['status'] = ORGANIZATION_DASHBOARD_STATUSES.OK,
): OrganizationDashboardMetric {
  return { key, value, unit, source: ORGANIZATION_DASHBOARD_SOURCES.COMPUTED, status }
}

function makeFreshness(
  source: OrganizationDashboardSourceFreshness['source'],
  lastUpdatedAt: string | null,
  isStale: boolean,
): OrganizationDashboardSourceFreshness {
  return { source, lastUpdatedAt, isStale, staleThresholdMinutes: 60, status: 'ok' as const }
}

function makeSummary(
  overrides: Partial<OrganizationDashboardSummary> = {},
): OrganizationDashboardSummary {
  return {
    meta: {
      calculatedAt: new Date().toISOString(),
      metricVersion: 'organization-dashboard.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 5,
      sections: [],
      attentionLimit: 5,
      activityLimit: 10,
      staleThresholdMinutes: 60,
      inputSignatureHash: 'x',
    },
    organization: {
      organizationId: 1,
      name: '北极星研发部',
      slug: 'northstar',
      planTier: null,
      createdAt: null,
    },
    kpis: [],
    statusDistribution: [] as OrganizationDashboardDistributionSlice[],
    attentionProjects: [] as OrganizationAttentionItem[],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 0,
      activeMembers: 0,
      roleDistribution: [],
      target: null,
      warnings: [],
    } as OrganizationMemberOverview,
    resourceOverview: {
      available: true,
      forbidden: false,
      allocatedProjectCount: 0,
      overloadedResourceCount: 0,
      totalAllocationPercent: null,
      target: null,
      warnings: [],
    } as OrganizationResourceOverview,
    riskReminders: [] as OrganizationRiskReminder[],
    recentActivity: [],
    pmoEntry: {
      available: false,
      forbidden: false,
      summary: null,
      freshness: null,
      targets: [],
      warnings: [],
    } as OrganizationPmoEntry,
    sourceFreshness: [] as OrganizationDashboardSourceFreshness[],
    warnings: [],
    ...overrides,
  }
}

// ─── 受限判定与中性文案 ───────────────────────────────────────────────────────

describe('org-overview-adapter：受限判定与「不可见」中性文案（RL-05）', () => {
  test('isMetricRedacted：forbidden 状态恒受限；value===null 恒受限（不依赖状态）', () => {
    expect(
      isMetricRedacted(
        makeMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
          null,
          'count',
          ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
        ),
      ),
    ).toBe(true)
    expect(
      isMetricRedacted(
        makeMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
          null,
          'count',
          ORGANIZATION_DASHBOARD_STATUSES.UNAVAILABLE,
        ),
      ),
    ).toBe(true)
    expect(
      isMetricRedacted(
        makeMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
          12,
          'count',
          ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
        ),
      ),
    ).toBe(true)
  })

  test('isMetricRedacted：可见数值（ok/empty 状态 + 非 null）判定为未脱敏', () => {
    expect(
      isMetricRedacted(makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, 8, 'count')),
    ).toBe(false)
    expect(
      isMetricRedacted(
        makeMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
          42,
          'percent',
          ORGANIZATION_DASHBOARD_STATUSES.EMPTY,
        ),
      ),
    ).toBe(false)
  })

  test('中性文案常量：只表达「无权限查看」，不含数值占位之外的任何猜测', () => {
    expect(ORG_OVERVIEW_REDACTED_TEXT).toBe('数据不可见')
    expect(ORG_OVERVIEW_REDACTED_HINT).toBe('当前无权限查看该分区，未显示任何数值')
    expect(ORG_OVERVIEW_REDACTED_TEXT).not.toMatch(/\d/)
    expect(ORG_OVERVIEW_REDACTED_HINT).not.toMatch(/\d/)
  })
})

// ─── 格式化边界 ───────────────────────────────────────────────────────────────

describe('org-overview-adapter：formatOrganizationMetricValue 边界', () => {
  test('受限/不可用 null 值统一渲染受限占位 --（绝不以 0 冒充真值）', () => {
    expect(
      formatOrganizationMetricValue(
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OPEN_RISK_COUNT, null),
      ),
    ).toBe('--')
  })

  test('percent 单位带 % 后缀；count/avg 原样数字', () => {
    expect(
      formatOrganizationMetricValue(
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG, 37, 'percent'),
      ),
    ).toBe('37%')
    expect(
      formatOrganizationMetricValue(
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, 0, 'count'),
      ),
    ).toBe('0')
    expect(
      formatOrganizationMetricValue(
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG, 72.5, 'avg'),
      ),
    ).toBe('72.5')
  })
})

// ─── 中文标签映射全覆盖 ───────────────────────────────────────────────────────

describe('org-overview-adapter：中文标签映射', () => {
  test('全部已登记 metric key 均有中文标签', () => {
    for (const key of ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES) {
      expect(ORGANIZATION_METRIC_LABELS[key]).toBeTruthy()
    }
    expect(ORGANIZATION_METRIC_LABELS[ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS]).toBe(
      '项目总数',
    )
    expect(ORGANIZATION_METRIC_LABELS[ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT]).toBe(
      '高风险',
    )
  })

  test('状态/健康度/提醒/来源/关注原因标签关键映射', () => {
    expect(ORGANIZATION_PROJECT_STATUS_LABELS.active).toBe('进行中')
    expect(ORGANIZATION_PROJECT_STATUS_LABELS.archived).toBe('已归档')
    expect(ORGANIZATION_HEALTH_LABELS.at_risk).toBe('风险')
    expect(ORGANIZATION_HEALTH_LABELS.critical).toBe('严重')
    expect(ORGANIZATION_REMINDER_LABELS[ORGANIZATION_REMINDER_CODES.HIGH_RISK]).toBe('高风险')
    expect(ORGANIZATION_REMINDER_LABELS[ORGANIZATION_REMINDER_CODES.OVERDUE_PROJECT]).toBe(
      '已延期项目',
    )
    expect(ORGANIZATION_SOURCE_LABELS[ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY]).toBe('资源')
    expect(ORGANIZATION_SOURCE_LABELS[ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG]).toBe('活动日志')
    expect(ORGANIZATION_SOURCE_LABELS[ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO]).toBe(
      'PMO 组合',
    )
  })

  test('全部 attention reason 均有中文标签', () => {
    for (const reason of ORGANIZATION_ATTENTION_REASON_VALUES) {
      expect(ORGANIZATION_ATTENTION_REASON_LABELS[reason]).toBeTruthy()
    }
    expect(ORGANIZATION_ATTENTION_REASON_LABELS.health_critical).toBe('健康度严重')
    expect(ORGANIZATION_ATTENTION_REASON_LABELS.no_progress).toBe('零进度')
  })

  test('warning：已登记 code 走标签，未知 code 回落原始 message（不展示空白）', () => {
    const known = {
      code: ORGANIZATION_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED,
      message: '原始信息不回显',
    }
    expect(formatOrganizationWarning(known)).toBe('部分维度因权限已脱敏')
    expect(ORGANIZATION_WARNING_LABELS[ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_STALE]).toBe(
      '数据源已过期',
    )
    const unknown: OrganizationDashboardWarning = {
      code: 'SOME_NEW_CODE' as OrganizationDashboardWarning['code'],
      message: '后端新文案',
    }
    expect(formatOrganizationWarning(unknown)).toBe('后端新文案')
  })
})

// ─── 相对时间与 stale 判定 ────────────────────────────────────────────────────

describe('org-overview-adapter：相对时间格式化', () => {
  const NOW = new Date('2026-09-10T12:00:00.000Z').getTime()

  test('刚刚 / N 分钟前边界', () => {
    expect(formatRelativeTime('2026-09-10T11:59:30.000Z', NOW)).toBe('刚刚')
    expect(formatRelativeTime('2026-09-10T11:59:00.001Z', NOW)).toBe('刚刚')
    expect(formatRelativeTime('2026-09-10T11:58:59.000Z', NOW)).toBe('1 分钟前')
    expect(formatRelativeTime('2026-09-10T11:01:00.000Z', NOW)).toBe('59 分钟前')
  })

  test('N 小时前 / N 天前边界', () => {
    expect(formatRelativeTime('2026-09-10T11:00:00.000Z', NOW)).toBe('1 小时前')
    expect(formatRelativeTime('2026-09-09T13:00:00.000Z', NOW)).toBe('23 小时前')
    expect(formatRelativeTime('2026-09-09T12:00:00.000Z', NOW)).toBe('1 天前')
    expect(formatRelativeTime('2026-09-01T12:00:00.000Z', NOW)).toBe('9 天前')
  })

  test('缺失/非法输入统一「未知」（不抛错不输出 NaN）', () => {
    expect(formatRelativeTime(null, NOW)).toBe('未知')
    expect(formatRelativeTime('not-a-date', NOW)).toBe('未知')
    expect(formatRelativeTime('2026-13-45T99:99:00.000Z', NOW)).toBe('未知')
  })

  test('staleSources：只挑后端标记 isStale 的来源；空/缺失摘要返回空数组', () => {
    const summary = makeSummary({
      sourceFreshness: [
        makeFreshness(ORGANIZATION_DASHBOARD_SOURCES.PROJECT, '2026-09-10T11:00:00.000Z', true),
        makeFreshness(ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP, '2026-09-10T11:30:00.000Z', false),
        makeFreshness(ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY, null, true),
      ],
    })
    const stale = staleSources(summary)
    expect(stale.map((item) => item.source)).toEqual([
      ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
      ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
    ])
    expect(staleSources(undefined)).toEqual([])
    expect(staleSources(makeSummary())).toEqual([])
  })
})

// ─── KPI 条选区 ───────────────────────────────────────────────────────────────

describe('org-overview-adapter：selectKpiStrip 缺省选区', () => {
  test('按固定顺序挑选，缺失 key 自动跳过，位置不因脱敏跳动', () => {
    const summary = makeSummary({
      kpis: [
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS, 2),
        // 平均进度受限（null）——仍保留卡位
        makeMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
          null,
          'percent',
          ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
        ),
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, 8),
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS, 3),
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS, 1),
        makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT, 0),
      ],
    })
    const strip = selectKpiStrip(summary)
    expect(strip.map((metric) => metric.key)).toEqual([
      ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
      ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
      ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS,
      ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS,
      ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
      ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
    ])
    expect(ORGANIZATION_KPI_STRIP_ORDER).toHaveLength(6)
  })

  test('摘要缺失返回空条；空组织判定由后端 EMPTY warning 驱动', () => {
    expect(selectKpiStrip(undefined)).toEqual([])
    expect(
      isEmptyOrganizationDashboard(
        makeSummary({
          warnings: [
            {
              code: ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD,
              message: '当前组织没有可见项目，指标为空而非缺失',
            },
          ],
        }),
      ),
    ).toBe(true)
    expect(isEmptyOrganizationDashboard(makeSummary())).toBe(false)
    expect(isEmptyOrganizationDashboard(undefined)).toBe(false)
  })
})
