/**
 * v3-ui-next-org-portfolio-domains W10 · tasks 10.7 —— 组织层 RBAC 权限矩阵 / 中性
 * 404 / 指标脱敏集成测试（spec「组织层 RBAC 权限矩阵、中性隔离与精确档三态」）。
 *
 * 与各 W 页级装配测试互补：本文件以统一夹具对「代表页」做矩阵化收口断言——
 * - 权限矩阵（组织概览 / OKR 仪表盘 / 容量环列表 / 插件目录）：无准入权限时受限
 *   横幅（或整页不渲染）且底层数据接口零请求（RL-06）；具备任一集合权限（如仅
 *   org:view 的 OKR 仪表盘——幽灵 okr:view 守卫修复回归）时查询 enabled 并发起；
 * - 跨租户/非法项目引用（全局资源 Hub 深链 `?projectId=` 失效）→ 中性「项目不存在
 *   或已被移除」空态且零项目资源请求（RL-05，不泄露存在性）；
 * - 受限指标卡零数值文本断言（RL-05 脱敏：FORBIDDEN KPI 只呈现「数据不可见」中性卡）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrgOverviewPage from '@/app/(next)/next/organization/page'
import OrganizationOkrsDashboardPage from '@/app/(next)/next/organization/okrs/dashboard/page'
import ResourceCapacityLoopsPage from '@/app/(next)/next/organization/resource-capacity-loops/page'
import NextOrgPluginDirectoryPage from '@/app/(next)/next/organization/plugin-directory/page'
import { GlobalResourcesHub } from '@/components/next/org-resources-global/GlobalResourcesHub'
import { makeProject } from './helpers/chart-gallery-network'
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

// ---------------------------------------------------------------------------
// 会话 & 网络夹具（与各 W 页级测试同构）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

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

interface RequestRecord {
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

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  setAuth(['task:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 组织概览数据夹具（含 FORBIDDEN 受限 KPI）
// ---------------------------------------------------------------------------
function makeMetric(
  key: OrganizationDashboardMetric['key'],
  value: number | null,
  unit: OrganizationDashboardMetric['unit'] = 'count',
  status: OrganizationDashboardMetric['status'] = ORGANIZATION_DASHBOARD_STATUSES.OK,
): OrganizationDashboardMetric {
  return { key, value, unit, source: ORGANIZATION_DASHBOARD_SOURCES.COMPUTED, status }
}

function makeOverviewSummary(): OrganizationDashboardSummary {
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
      // 受限 KPI：后端 FORBIDDEN → 前端只呈现「数据不可见」中性卡，零数值
      makeMetric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        null,
        'percent',
        ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
      ),
    ],
    statusDistribution: [],
    attentionProjects: [],
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

function overviewBackend() {
  const summary = makeOverviewSummary()
  const layout = makeLayout()
  return (path: string, method: string): Response | null => {
    if (path === '/organizations/1/dashboard' && method === 'GET') {
      return jsonResponse(200, { data: summary })
    }
    if (path === '/organizations/1/dashboard/layouts/current' && method === 'GET') {
      return jsonResponse(200, { data: { layout, warnings: [] } })
    }
    return null
  }
}

// ---------------------------------------------------------------------------
describe('权限矩阵：四代表页无准入权限 → 受限呈现且底层接口零请求（RL-06）', () => {
  test('组织概览页：无 org:view/portfolio:view → 受限横幅，/dashboard 与 /layouts 零请求', async () => {
    const { records } = installFetchRouter(() => null)
    renderPage(<OrgOverviewPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-org-overview-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('OKR 仪表盘页：无 org:view/portfolio:view → 受限横幅，/okrs/dashboard 零请求', async () => {
    const { records } = installFetchRouter(() => null)
    renderPage(<OrganizationOkrsDashboardPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('容量环列表页：无 resource_capacity_loop:view → 受限横幅，容量环接口零请求', async () => {
    const { records } = installFetchRouter(() => null)
    renderPage(<ResourceCapacityLoopsPage />)

    expect(document.querySelector('[data-rccl-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看资源容量闭环的权限')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('插件目录页：无 plugin_registry:view → 整页不渲染（不暴露入口存在性），零业务请求', async () => {
    const { records } = installFetchRouter(() => null)
    renderPage(<NextOrgPluginDirectoryPage />)

    expect(document.querySelector('[data-plugin-directory-workspace]')).toBeNull()
    expect(document.body.textContent?.trim()).toBe('')
    await settle()
    expect(records).toHaveLength(0)
  })

  test('幽灵守卫修复回归：仅持 org:view（无 okr:view 声明）的 OKR 仪表盘查询正常发起', async () => {
    setAuth(['org:view'])
    const { records } = installFetchRouter(overviewBackend())
    renderPage(<OrganizationOkrsDashboardPage />)

    // 旧轨守卫恒拒（okr:view 未登记）→ 修复后具备 org:view 即 enabled 发起查询
    await settle(80)
    expect(records.some((record) => record.url.includes('/organizations/1/okrs/dashboard'))).toBe(
      true,
    )
  })
})

describe('RL-05 指标脱敏：受限 KPI 卡零数值文本（组织概览页）', () => {
  test('FORBIDDEN 受限 KPI 仅呈现「数据不可见」中性卡，不出现任何猜测数值', async () => {
    setAuth(['org:view'])
    installFetchRouter(overviewBackend())
    renderPage(<OrgOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-org-overview-workspace]')).not.toBeNull(),
    )
    const redactedCard = document.querySelector('[data-org-kpi-card="org_overall_progress_avg"]')
    expect(redactedCard).not.toBeNull()
    expect(redactedCard?.textContent).toContain('数据不可见')
    expect(redactedCard?.textContent).not.toMatch(/\d/)
  })
})

describe('RL-05 中性隔离：全局资源 Hub 失效项目引用（跨租户/已移除）', () => {
  test('URL projectId 引用不在可见项目列表 → 中性「项目不存在或已被移除」且零项目资源请求', async () => {
    setAuth(['resource:view', 'portfolio:view'])
    searchParamsMock.value = new URLSearchParams('projectId=999')
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/projects') && method === 'GET') {
        return jsonResponse(200, {
          data: [makeProject({ id: 1 }), makeProject({ id: 2 })],
          meta: { total: 2, page: 1, perPage: 200, totalPages: 1 },
        })
      }
      return null
    })
    renderPage(<GlobalResourcesHub initialProjectId={999} />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-project-missing]')).not.toBeNull(),
    )
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    // 失效引用零资源请求防探测：绝不向 /projects/999/resources* 发起请求
    await settle()
    expect(records.some((record) => record.url.includes('/projects/999/resources'))).toBe(false)
    expect(records.every((record) => record.url.startsWith('/projects'))).toBe(true)
  })
})
