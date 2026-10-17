/**
 * v3-ui-next-org-portfolio-domains W1 · tasks 1.4 —— 组织概览主工作台组件测试
 * （spec「组织概览工作台与指标级脱敏」场景）。
 *
 * 覆盖：
 * - 各分区装配（身份页头/KPI 条/状态分布/待关注队列/成员与资源概览/风险提醒/
 *   活动流/PMO 入口），缺省布局（无当前布局）回落系统默认模块清单；
 * - KPI 条缺省选区（固定顺序、受限卡保留卡位）与分区折叠交互（aria-expanded）；
 * - RL-05 脱敏：受限指标卡/受限概览卡不出现任何数值文本（EyeOff + 中性文案）；
 * - 空组织语义横幅（后端 EMPTY warning 驱动）与 stale 数据源徽标；
 * - 错误态：404/403 中性受限态无重试按钮，5xx 可重试（refetch 触发）。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { OrgOverviewWorkspace } from '@/components/next/org-overview/OrgOverviewWorkspace'
import { ORG_OVERVIEW_REDACTED_TEXT } from '@/lib/next/org-overview/org-overview-adapter'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_DASHBOARD_WARNING_CODES,
  ORGANIZATION_REMINDER_CODES,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  type OrganizationDashboardLayout,
  type OrganizationDashboardMetric,
  type OrganizationDashboardSummary,
} from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 可控 hook mock（组件测试零网络）
// ---------------------------------------------------------------------------
type DashboardQueryState = {
  data: OrganizationDashboardSummary | undefined
  isPending: boolean
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: ReturnType<typeof vi.fn>
}

const dashboardMock = vi.hoisted(() => ({
  state: {
    data: undefined,
    isPending: true,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(() => Promise.resolve()),
  } as DashboardQueryState,
}))

const layoutMock = vi.hoisted(() => ({
  state: {
    data: undefined as { layout: OrganizationDashboardLayout; warnings: unknown[] } | undefined,
    isLoading: true,
  },
}))

vi.mock('@/hooks/use-organization-dashboard', () => ({
  useOrganizationDashboard: () => dashboardMock.state,
}))

vi.mock('@/hooks/use-organization-dashboard-layout', () => ({
  useCurrentLayout: () => layoutMock.state,
}))

function ready(query: DashboardQueryState, summary: OrganizationDashboardSummary) {
  query.data = summary
  query.isPending = false
  query.isLoading = false
  query.isError = false
  query.error = null
}

function loading(query: DashboardQueryState) {
  query.data = undefined
  query.isPending = true
  query.isLoading = true
  query.isError = false
  query.error = null
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
function makeMetric(
  key: OrganizationDashboardMetric['key'],
  value: number | null,
  unit: OrganizationDashboardMetric['unit'] = 'count',
  status: OrganizationDashboardMetric['status'] = ORGANIZATION_DASHBOARD_STATUSES.OK,
): OrganizationDashboardMetric {
  return { key, value, unit, source: ORGANIZATION_DASHBOARD_SOURCES.COMPUTED, status }
}

function makeSummary(
  overrides: Partial<OrganizationDashboardSummary> = {},
): OrganizationDashboardSummary {
  return {
    meta: {
      calculatedAt: '2026-09-10T11:59:30.000Z',
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
    kpis: [
      makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, 8),
      makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS, 3),
      makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS, 2),
      makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS, 1),
      makeMetric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        null,
        'percent',
        ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
      ),
      makeMetric(ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT, 2),
    ],
    statusDistribution: [
      { key: 'planning', label: '规划中', count: 2, percent: 25 },
      { key: 'active', label: '进行中', count: 5, percent: 62.5 },
      { key: 'completed', label: '已完成', count: 1, percent: 12.5 },
    ],
    attentionProjects: [
      {
        projectId: 101,
        projectName: '智能车载系统研发',
        status: 'active',
        healthStatus: 'critical',
        progressPercent: 15,
        attentionScore: 70,
        reasons: ['health_critical', 'overdue'],
        overdueTaskCount: 3,
        target: { kind: 'project', href: '/next/projects/101', authorized: true },
        warnings: [],
      },
      {
        projectId: 102,
        projectName: '商城重构二期',
        status: 'active',
        healthStatus: 'at_risk',
        progressPercent: 60,
        attentionScore: 20,
        reasons: ['health_at_risk'],
        overdueTaskCount: null,
        target: null,
        warnings: [],
      },
    ],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 12,
      activeMembers: 9,
      roleDistribution: [
        { key: 'admin', label: '管理员', count: 1, percent: 8.3 },
        { key: 'member', label: '成员', count: 11, percent: 91.7 },
      ],
      target: { kind: 'member', href: '/members', authorized: true },
      warnings: [],
    },
    resourceOverview: {
      available: true,
      forbidden: false,
      allocatedProjectCount: 4,
      overloadedResourceCount: 1,
      totalAllocationPercent: 78,
      target: null,
      warnings: [],
    },
    riskReminders: [
      {
        code: ORGANIZATION_REMINDER_CODES.HIGH_RISK,
        label: '高风险项目',
        count: 2,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        target: { kind: 'risk', href: '/risks', authorized: true },
        warnings: [],
      },
      {
        code: ORGANIZATION_REMINDER_CODES.OPEN_RISK,
        label: '未关闭风险',
        count: null,
        status: ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        target: null,
        warnings: [],
      },
    ],
    recentActivity: [
      {
        id: 1,
        action: '创建了项目 智慧园区平台',
        entityType: 'project',
        severity: 'info',
        projectId: 101,
        occurredAt: '2026-09-10T11:50:00.000Z',
        target: { kind: 'project', href: '/next/projects/101', authorized: true },
      },
      {
        id: 2,
        action: '更新了成员角色',
        entityType: 'membership',
        severity: 'info',
        projectId: null,
        occurredAt: '2026-09-09T08:00:00.000Z',
        target: null,
      },
    ],
    pmoEntry: {
      available: true,
      forbidden: false,
      summary: { totalProjects: 8, atRiskProjects: 2, overallProgressAvg: 46 },
      freshness: null,
      targets: [{ kind: 'pmo', href: '/pmo', authorized: true }],
      warnings: [],
    },
    sourceFreshness: [
      {
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        lastUpdatedAt: '2026-09-09T10:00:00.000Z',
        isStale: true,
        staleThresholdMinutes: 60,
        status: ORGANIZATION_DASHBOARD_STATUSES.STALE,
      },
      {
        source: ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        lastUpdatedAt: '2026-09-10T11:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
        status: ORGANIZATION_DASHBOARD_STATUSES.OK,
      },
    ],
    warnings: [],
    ...overrides,
  }
}

function makeLayout(
  overrides: Partial<OrganizationDashboardLayout> = {},
): OrganizationDashboardLayout {
  return {
    layoutId: 1,
    organizationId: 1,
    scope: 'personal',
    ownerActorId: 1,
    name: '我的布局',
    version: 3,
    isDefault: false,
    density: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
    modules: ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.map((module) => ({ ...module })),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const KPI_ORDER = [
  ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
]

function renderWorkspace() {
  const onOpenLayoutEditor = vi.fn()
  const view = render(<OrgOverviewWorkspace onOpenLayoutEditor={onOpenLayoutEditor} />)
  return { onOpenLayoutEditor, view }
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: ['org:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
  dashboardMock.state.refetch.mockReset()
})

// ---------------------------------------------------------------------------
// 各分区装配（缺省布局回落系统默认模块清单）
// ---------------------------------------------------------------------------
describe('OrgOverviewWorkspace：分区装配与缺省布局（spec「组织概览工作台」）', () => {
  test('骨架屏：首载 loading 渲染几何骨架且 aria-busy', () => {
    loading(dashboardMock.state)
    layoutMock.state.data = undefined
    renderWorkspace()
    expect(document.querySelector('[data-org-overview-skeleton]')).not.toBeNull()
    expect(document.querySelector('[data-org-overview-workspace]')).toBeNull()
  })

  test('完整数据：九分区齐备、身份页头与 KPI 缺省选区顺序稳定', async () => {
    ready(dashboardMock.state, makeSummary())
    layoutMock.state.data = { layout: makeLayout(), warnings: [] }
    renderWorkspace()

    // 身份页头
    expect(screen.getByRole('heading', { name: '北极星研发部' })).toBeInTheDocument()
    const meta = document.querySelector('[data-org-overview-meta]')
    expect(meta?.textContent).toContain('@northstar')
    expect(meta?.textContent).toContain('可见项目 5 个')

    // 9 个可渲染分区（系统默认清单，无布局时同样回落）
    const sections = document.querySelectorAll('[data-org-section]')
    expect(sections).toHaveLength(9)

    // KPI 缺省选区顺序固定：受限卡保留卡位
    const kpiCards = document.querySelectorAll('[data-org-kpi-card]')
    expect(kpiCards).toHaveLength(6)
    expect(Array.from(kpiCards).map((card) => card.getAttribute('data-org-kpi-card'))).toEqual(
      KPI_ORDER,
    )

    // 状态分布 + 待关注队列
    expect(document.querySelector('[data-org-status-row="active"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-org-attention-item]')).toHaveLength(2)
    expect(document.querySelector('[data-org-attention-reason="health_critical"]')).not.toBeNull()
    expect(screen.getByText('健康度严重')).toBeInTheDocument()

    // 成员/资源/提醒/活动/PMO
    expect(document.querySelector('[data-org-member-card]')).not.toBeNull()
    expect(document.querySelector('[data-org-resource-card]')).not.toBeNull()
    expect(document.querySelectorAll('[data-org-reminder-card]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-org-activity-item]')).toHaveLength(2)
    expect(document.querySelector('[data-org-pmo-card]')).not.toBeNull()

    // 授权 target 走安全链接（next/link mock 为 <a>）
    const pmoLink = document.querySelector('[data-org-pmo-card] a')
    expect(pmoLink?.getAttribute('href')).toBe('/pmo')
  })

  test('stale 来源徽标与空组织语义横幅（后端 warning 驱动）', () => {
    ready(
      dashboardMock.state,
      makeSummary({
        warnings: [
          {
            code: ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD,
            message: '当前组织没有可见项目，指标为空而非缺失',
          },
        ],
      }),
    )
    layoutMock.state.data = undefined
    renderWorkspace()

    expect(document.querySelector('[data-org-stale-badge]')?.textContent).toContain(
      '1 个数据源已过期',
    )
    expect(document.querySelector('[data-org-overview-empty]')).not.toBeNull()
    expect(screen.getByText('当前组织还没有可见项目')).toBeInTheDocument()
    // 空组织仍渲染分区（默认清单回落）
    expect(document.querySelectorAll('[data-org-section]')).toHaveLength(9)
  })

  test('布局驱动：隐藏分区不渲染、密度令牌随布局下发', () => {
    const layout = makeLayout({
      modules: ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.filter(
        (module) => module.moduleKey !== ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW,
      ),
      density: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT,
    })
    ready(dashboardMock.state, makeSummary())
    layoutMock.state.data = { layout, warnings: [] }
    renderWorkspace()

    expect(document.querySelectorAll('[data-org-section]')).toHaveLength(8)
    expect(document.querySelector('[data-org-section="member_overview"]')).toBeNull()
    expect(
      document.querySelector('[data-org-overview-workspace]')?.getAttribute('data-org-density'),
    ).toBe('compact')
  })

  test('「布局编排」按钮呼出回调', () => {
    ready(dashboardMock.state, makeSummary())
    layoutMock.state.data = undefined
    const { onOpenLayoutEditor } = renderWorkspace()
    const trigger = document.querySelector('[data-org-layout-edit-open]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger as Element)
    expect(onOpenLayoutEditor).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 受限指标脱敏（RL-05）
// ---------------------------------------------------------------------------
describe('OrgOverviewWorkspace：指标级脱敏（spec「受限分区中性呈现」场景）', () => {
  test('受限 KPI 卡：EyeOff + 中性文案，不出现任何数值文本', () => {
    ready(dashboardMock.state, makeSummary())
    layoutMock.state.data = undefined
    renderWorkspace()

    const card = document.querySelector('[data-org-kpi-card="org_overall_progress_avg"]')
    expect(card?.getAttribute('data-org-kpi-redacted')).toBe('true')
    expect(card?.textContent).toContain('平均进度')
    expect(card?.textContent).toContain(ORG_OVERVIEW_REDACTED_TEXT)
    // RL-05：受限卡零数值文本
    expect(card?.textContent).not.toMatch(/\d/)
    expect(card?.textContent).not.toContain('%')
    // 可见 KPI 卡不受影响
    const visible = document.querySelector('[data-org-kpi-card="org_total_projects"]')
    expect(visible?.getAttribute('data-org-kpi-redacted')).toBe('false')
    expect(visible?.textContent).toContain('8')
  })

  test('受限成员/资源/PMO 概览与受限风险提醒：中性呈现且零数值', () => {
    ready(
      dashboardMock.state,
      makeSummary({
        memberOverview: {
          available: false,
          forbidden: true,
          totalMembers: null,
          activeMembers: null,
          roleDistribution: [],
          target: null,
          warnings: [],
        },
        resourceOverview: {
          available: false,
          forbidden: true,
          allocatedProjectCount: null,
          overloadedResourceCount: null,
          totalAllocationPercent: null,
          target: null,
          warnings: [],
        },
        pmoEntry: {
          available: false,
          forbidden: true,
          summary: null,
          freshness: null,
          targets: [],
          warnings: [],
        },
      }),
    )
    layoutMock.state.data = undefined
    renderWorkspace()

    const redacted = document.querySelectorAll('[data-org-overview-redacted]')
    expect(redacted.length).toBeGreaterThanOrEqual(3)
    for (const node of redacted) {
      expect(node.textContent).toContain(ORG_OVERVIEW_REDACTED_TEXT)
      expect(node.textContent).not.toMatch(/\d/)
    }
    // 受限分区卡片整体不出现任何数字文本
    const memberSection = document.querySelector('[data-org-section="member_overview"]')
    expect(memberSection?.textContent).not.toMatch(/\d/)
    const resourceSection = document.querySelector('[data-org-section="resource_overview"]')
    expect(resourceSection?.textContent).not.toMatch(/\d/)
    const pmoSection = document.querySelector('[data-org-section="pmo_entry"]')
    expect(pmoSection?.textContent).not.toMatch(/\d/)
    // 受限提醒卡不渲染计数
    const redactedReminder = document.querySelector('[data-org-reminder-card="open_risk"]')
    expect(redactedReminder?.textContent).toContain(ORG_OVERVIEW_REDACTED_TEXT)
    expect(redactedReminder?.textContent).not.toMatch(/\d/)
    // 可见提醒卡计数正常回显
    expect(document.querySelector('[data-org-reminder-card="high_risk"]')?.textContent).toContain(
      '2',
    )
  })
})

// ---------------------------------------------------------------------------
// 折叠交互
// ---------------------------------------------------------------------------
describe('OrgOverviewWorkspace：分区折叠交互', () => {
  test('折叠 KPI 分区后内容卸载且 aria-expanded=false，再展开恢复', () => {
    ready(dashboardMock.state, makeSummary())
    layoutMock.state.data = undefined
    renderWorkspace()

    expect(document.querySelectorAll('[data-org-kpi-card]')).toHaveLength(6)
    const toggle = document.querySelector('[data-org-section-toggle="kpi_strip"]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle as Element)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelectorAll('[data-org-kpi-card]')).toHaveLength(0)

    fireEvent.click(toggle as Element)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[data-org-kpi-card]')).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// 错误态（受限中性 vs 可重试）
// ---------------------------------------------------------------------------
describe('OrgOverviewWorkspace：错误态三态闭环', () => {
  test('404/403 中性受限态：无重试按钮（不泄露存在性差异）', () => {
    dashboardMock.state.data = undefined
    dashboardMock.state.isPending = false
    dashboardMock.state.isLoading = false
    dashboardMock.state.isError = true
    dashboardMock.state.error = { status: 404, code: 'RESOURCE_NOT_FOUND', message: '未找到' }
    renderWorkspace()

    expect(document.querySelector('[data-org-overview-error]')).not.toBeNull()
    expect(document.querySelector('[data-org-overview-restricted]')).not.toBeNull()
    expect(document.querySelector('[data-org-overview-retry]')).toBeNull()
    expect(dashboardMock.state.refetch).not.toHaveBeenCalled()
  })

  test('5xx 可重试：重试按钮触发 refetch', () => {
    dashboardMock.state.data = undefined
    dashboardMock.state.isPending = false
    dashboardMock.state.isLoading = false
    dashboardMock.state.isError = true
    dashboardMock.state.error = { status: 503, code: 'INTERNAL', message: '服务不可用' }
    renderWorkspace()

    expect(document.querySelector('[data-org-overview-error]')).not.toBeNull()
    expect(document.querySelector('[data-org-overview-restricted]')).toBeNull()
    const retry = document.querySelector('[data-org-overview-retry]')
    expect(retry).not.toBeNull()
    fireEvent.click(retry as Element)
    expect(dashboardMock.state.refetch).toHaveBeenCalledTimes(1)
  })
})
