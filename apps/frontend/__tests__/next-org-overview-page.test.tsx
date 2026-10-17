/**
 * v3-ui-next-org-portfolio-domains W1 · tasks 1.8 —— 组织概览页面装配与 RBAC 测试
 * （spec「组织概览工作台与指标级脱敏」页面场景）。
 *
 * 覆盖：
 * - 无 org:view/portfolio:view：受限横幅（data-permission-fallback）渲染且
 *   dashboard/layouts 底层接口零请求（RL-06）；
 * - 未选择组织：中性引导态且零请求；
 * - 授权装配（含仅 portfolio:view 的 PM 兜底准入）：dashboard + layouts/current
 *   双请求正常、工作台齐备、布局编排抽屉可打开；
 * - 顶栏坐标回显（resolveSpaceBreadcrumb 镜像探针）路径段 `/next/organization ·`
 *   （精确标签随 W10 坐标注册定案为「组织概览」，页面内标题同源锁定语义）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrgOverviewPage from '@/app/(next)/next/organization/page'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
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
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

export interface RequestRecord {
  method: string
  url: string
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
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

function makeSummary(): OrganizationDashboardSummary {
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
    statusDistribution: [{ key: 'active', label: '进行中', count: 5, percent: 100 }],
    attentionProjects: [
      {
        projectId: 101,
        projectName: '智能车载系统研发',
        status: 'active',
        healthStatus: 'critical',
        progressPercent: 15,
        attentionScore: 70,
        reasons: ['health_critical'],
        overdueTaskCount: 3,
        target: { kind: 'project', href: '/next/projects/101', authorized: true },
        warnings: [],
      },
    ],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 12,
      activeMembers: 9,
      roleDistribution: [],
      target: null,
      warnings: [],
    },
    resourceOverview: {
      available: true,
      forbidden: false,
      allocatedProjectCount: 4,
      overloadedResourceCount: 1,
      totalAllocationPercent: null,
      target: null,
      warnings: [],
    },
    riskReminders: [],
    recentActivity: [],
    pmoEntry: {
      available: true,
      forbidden: false,
      summary: { totalProjects: 8, atRiskProjects: 2, overallProgressAvg: 46 },
      freshness: null,
      targets: [{ kind: 'pmo', href: '/pmo', authorized: true }],
      warnings: [],
    },
    sourceFreshness: [],
    warnings: [],
  }
}

function makeLayout(): OrganizationDashboardLayout {
  return {
    layoutId: 1,
    organizationId: 1,
    scope: 'personal',
    ownerActorId: 1,
    name: '我的概览布局',
    version: 1,
    isDefault: false,
    density: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
    modules: ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.map((module) => ({ ...module })),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function createBackend() {
  const summary = makeSummary()
  const layout = makeLayout()
  const route = (path: string, method: string): Response | null => {
    if (path === '/organizations/1/dashboard' && method === 'GET') {
      return jsonResponse(200, { data: summary })
    }
    if (path === '/organizations/1/dashboard/layouts/current' && method === 'GET') {
      return jsonResponse(200, { data: { layout, warnings: [] } })
    }
    return null
  }
  return { route }
}

/** 顶栏坐标回显探针（镜像 NextAppShell 消费公式）。 */
function BreadcrumbEchoProbe({ pathname }: { pathname: string }) {
  return <span data-coordinate-echo>{resolveSpaceBreadcrumb(pathname)}</span>
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  setAuth(['org:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 权限与组织上下文守卫（零请求）
// ---------------------------------------------------------------------------
describe('OrgOverviewPage：RBAC 守卫与组织上下文（spec「无组织层权限被物理阻断」）', () => {
  test('无 org:view 与 portfolio:view：受限横幅渲染且 dashboard/layouts 接口零请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<OrgOverviewPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看组织概览的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-org-overview-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：中性引导态渲染且零请求', async () => {
    // 有效租户缺失（无组织成员关系 + JWT 无组织声明）→ 引导态，绝不静默空转。
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['org:view'],
    })
    const { records } = installFetchRouter(() => null)
    renderPage(<OrgOverviewPage />)

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 授权装配（含 PM 的 portfolio:view 兜底准入）
// ---------------------------------------------------------------------------
describe('OrgOverviewPage：授权用户完整装配', () => {
  test('org:view 成员：dashboard 与 layouts/current 双请求，工作台齐备', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrgOverviewPage />)

    // 骨架 → 工作台
    expect(document.querySelector('[data-org-overview-skeleton]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-org-overview-workspace]')).not.toBeNull(),
    )
    expect(screen.getByRole('heading', { name: '北极星研发部' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-org-section]')).toHaveLength(9)
    expect(document.querySelectorAll('[data-org-kpi-card]')).toHaveLength(6)

    // 受限 KPI 卡（org_overall_progress_avg）零数值文本
    const redactedCard = document.querySelector('[data-org-kpi-card="org_overall_progress_avg"]')
    expect(redactedCard?.textContent).not.toMatch(/\d/)
    expect(redactedCard?.textContent).toContain('数据不可见')

    // 请求记录：恰好 dashboard + current layout 两条 GET，零写请求
    await waitFor(() => {
      const dashboardGets = records.filter(
        (record) => record.url === '/organizations/1/dashboard' && record.method === 'GET',
      )
      const layoutGets = records.filter(
        (record) =>
          record.url === '/organizations/1/dashboard/layouts/current' && record.method === 'GET',
      )
      expect(dashboardGets.length).toBeGreaterThanOrEqual(1)
      expect(layoutGets.length).toBeGreaterThanOrEqual(1)
    })
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('仅 portfolio:view 的 PM：经任一集合兜底准入并完整装配（回归幽灵守卫口径）', async () => {
    setAuth(['portfolio:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrgOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-org-overview-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(screen.getByRole('heading', { name: '北极星研发部' })).toBeInTheDocument()
    await waitFor(() =>
      expect(records.some((record) => record.url === '/organizations/1/dashboard')).toBe(true),
    )
  })

  test('布局编排入口：点击打开抽屉并回显当前布局模块', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<OrgOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-org-overview-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-org-layout-editor]')).toBeNull()

    fireEvent.click(document.querySelector('[data-org-layout-edit-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-org-layout-editor]')).not.toBeNull())
    expect(document.querySelector('[data-org-layout-panel]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(9),
    )
    expect(document.querySelector('[data-org-layout-scope-info]')?.textContent).toContain(
      '个人布局',
    )

    fireEvent.click(document.querySelector('[data-org-layout-close]') as Element)
    expect(document.querySelector('[data-org-layout-editor]')).toBeNull()
  })

  test('面包屑回显：坐标探针路径段 /next/organization · <标签>（标签随坐标注册定案）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(
      <>
        <OrgOverviewPage />
        <BreadcrumbEchoProbe pathname="/next/organization" />
      </>,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-org-overview-workspace]')).not.toBeNull(),
    )

    const echo = document.querySelector('[data-coordinate-echo]')
    expect(echo?.textContent).toMatch(/^\/next\/organization ·/)
    // 页面内标题与坐标标签语义同源锁定「组织概览」
    const header = document.querySelector('[data-org-overview-title]')
    expect(header?.textContent).toBe('北极星研发部')
    expect(document.body.textContent).toContain('组织概览')
  })
})
