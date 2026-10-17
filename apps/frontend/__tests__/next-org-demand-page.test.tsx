/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.10 —— 需求预测页面入口装配与 RBAC 测试。
 *
 * - 权限守卫口径：`org:view`/`portfolio:view`/`resource:view` 任一即可
 *   （与后端 ResourceDemandForecastingPolicy 视图并集一致）；无权限渲染受限横幅
 *   且底层预测接口零请求（RL-06）；
 * - 未选择组织 → 「请先选择组织」引导态且零请求（RL-05）；AI 咨询端点零自动触发；
 * - 授权用户完整装配（工作台标题/摘要卡渲染 + 数据请求发出）；面包屑坐标由顶栏
 *   静态坐标回显（接线 W10 产物，页面层不重复断言）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationResourceDemandForecastingPage from '@/app/(next)/next/organization/resource-demand-forecasting/page'
import { ensureLazyEchartsMock } from './helpers/echarts-mock'
import type { ForecastSummary } from '@aiproj/types'

vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      return (bundle.module.default as { init: (d: HTMLElement) => unknown }).init(dom)
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-demand-forecasting',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations:
        organizationId === null
          ? []
          : [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

const SOURCE_KEYS = [
  'project_plans',
  'task_resource_requirements',
  'resource_registry',
  'resource_allocations',
  'resource_availability',
  'working_calendar',
  'organization_resource_pool',
  'resource_skill_matrix',
  'resource_load_facts',
  'historical_snapshot',
] as const

function makeSummary(): ForecastSummary {
  return {
    window: {
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      granularity: 'week',
      bucketCount: 13,
    },
    metrics: {
      forecast_total_demand_hours: 1000,
      forecast_total_allocated_hours: 700,
      forecast_total_available_hours: 1300,
      forecast_total_remaining_hours: 600,
      forecast_projected_gap_hours: 300,
      forecast_visible_project_count: 3,
      forecast_visible_resource_count: 10,
      forecast_skill_coverage_ratio: 0.8,
      forecast_shortage_count: 4,
      forecast_surplus_count: 1,
    },
    freshness: {
      sources: Object.fromEntries(
        SOURCE_KEYS.map((key) => [key, '2026-09-01T00:00:00.000Z']),
      ) as Record<(typeof SOURCE_KEYS)[number], string | null>,
      overallFreshness: '2026-09-01T00:00:00.000Z',
      isStale: false,
      staleSources: [],
      sourceCoverage: 1,
      freshnessHash: 'abc',
    },
    overallConfidence: 'medium',
    method: 'deterministic_bucket',
    warnings: [],
    projectCoverage: 1,
    resourceCoverage: 1,
  }
}

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: Array<{ method: string; url: string }>
} {
  const records: Array<{ method: string; url: string }> = []
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

function backendRoute(path: string, method: string): Response | null {
  if (method !== 'GET') return null
  const base = '/organizations/1/resource-demand-forecasting'
  if (path.startsWith(`${base}/summary`)) {
    return jsonResponse(200, { data: makeSummary() })
  }
  if (path.startsWith(`${base}/demand-curves`)) {
    return jsonResponse(200, {
      data: { roleBuckets: [], skillBuckets: [], projectBuckets: [], warnings: [] },
    })
  }
  if (path.startsWith(`${base}/gap-analysis`)) {
    return jsonResponse(200, {
      data: { gaps: [], totalShortage: 0, totalSurplus: 0, netGap: 0, warnings: [] },
    })
  }
  if (path.startsWith(`${base}/project-drivers`)) {
    return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
  }
  if (path.startsWith(`${base}/skill-drivers`)) {
    return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
  }
  if (path === `${base}/ai-advisory`) {
    return jsonResponse(200, {
      data: {
        advisoryOnly: true,
        writesApplied: false,
        narrative: '测试洞察',
        relatedGaps: [],
        suggestedActions: [],
        warnings: [],
        confidence: 'medium',
        model: 'codex-5',
      },
    })
  }
  return null
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrganizationResourceDemandForecastingPage />
    </QueryClientProvider>,
  )
}

const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE']

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  window.history.replaceState({}, '', '/next/organization/resource-demand-forecasting')
  ensureLazyEchartsMock().reset()
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('资源需求预测页面入口：权限矩阵与零请求（tasks 5.10）', () => {
  test('具备 org:view：完整装配并发出预测数据请求；AI 端点零自动触发', async () => {
    setAuth(['org:view', 'resource:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-demand-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())
    expect(document.querySelector('[data-demand-title]')?.textContent).toBe('资源需求预测')
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-no-organization-guide]')).toBeNull()
    expect(records.some((r) => r.url.includes('/resource-demand-forecasting/summary'))).toBe(true)
    // AI 咨询零自动触发（初始无 ai-advisory 请求，RL-01）
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.some((r) => r.url.includes('/ai-advisory'))).toBe(false)
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('任一权限即可准入：仅 resource:view 亦可加载数据', async () => {
    setAuth(['resource:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-demand-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())
    expect(records.some((r) => r.url.includes('/resource-demand-forecasting/summary'))).toBe(true)
  })

  test('仅 portfolio:view（PM 无 org:view）亦可准入', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-demand-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())
    expect(records.some((r) => r.url.includes('/resource-demand-forecasting/summary'))).toBe(true)
  })

  test('无 org:view/portfolio:view/resource:view：受限横幅渲染且底层接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-demand-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('未选择组织：引导态「请先选择组织」且零请求（RL-05）', async () => {
    setAuth(['org:view', 'portfolio:view', 'resource:view'], null)
    const { records } = installFetchRouter(() => null)
    renderPage()
    expect(document.querySelector('[data-no-organization-guide]')).not.toBeNull()
    expect(document.querySelector('[data-demand-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})
