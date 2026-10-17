/**
 * v3-ui-next-pmo-domain W1 · tasks 1.2 —— /next/pmo 组合仪表盘路由与容器测试
 * （spec「PMO 组合仪表盘新轨主页与组织层信息架构」页面场景）。
 *
 * 覆盖：
 * - 无 `portfolio:view`：受限横幅（data-permission-fallback）且业务接口零请求
 *   （RL-06）；页面不存在数据请求；
 * - 未选择组织：中性引导态（data-org-no-organization）且零请求（RL-05）；
 * - 授权装配：组合摘要单请求（includeTrafficLight + includeFreshness）、KPI/
 *   交通灯摘要/告警/投入分布区块渲染、可见项目口径行；
 * - Tab 与子导航：分组视图 Tab / 优先级评分 / 组织资源池路由跳转；决策工作台
 *   按钮仅对持有 `pmo_decision:view` 的用户呈现；页头返回角色首页；
 * - 三态：加载骨架屏 aria-busy 无空态闪烁 / 空内容语义空态 / 403 中性受限态
 *   与 5xx 错误卡重试闭环；
 * - 全程（含重试/导航）网络监控零写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoPortfolioOverviewPage from '@/app/(next)/next/pmo/page'
import type {
  PortfolioDashboardMetric,
  PortfolioDashboardSummary,
  PortfolioTrafficLightBlock,
} from '@aiproj/types'
import { PORTFOLIO_DASHBOARD_METRIC_STATUSES, PORTFOLIO_DASHBOARD_SOURCES } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
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

interface RequestRecord {
  method: string
  url: string
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
  navMock.push.mockClear()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

// ---------------------------------------------------------------------------
// 摘要夹具
// ---------------------------------------------------------------------------
function makeMetric(
  key: string,
  value: number | null,
  unit: PortfolioDashboardMetric['unit'] = 'count',
  status: PortfolioDashboardMetric['status'] = PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
  warnings: PortfolioDashboardMetric['warnings'] = [],
): PortfolioDashboardMetric {
  return {
    key: key as PortfolioDashboardMetric['key'],
    value,
    unit,
    source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
    status,
    warnings,
  }
}

function makeTrafficLight(
  overrides: Partial<PortfolioTrafficLightBlock> = {},
): PortfolioTrafficLightBlock {
  return {
    available: true,
    forbidden: false,
    redCount: 2,
    yellowCount: 1,
    greenCount: 3,
    grayCount: 0,
    warnings: [],
    ...overrides,
  }
}

function makeSummary(
  overrides: Partial<PortfolioDashboardSummary> = {},
): PortfolioDashboardSummary {
  return {
    meta: {
      calculatedAt: '2026-09-01T08:00:00.000Z',
      metricVersion: 'portfolio-dashboard.v1',
      organizationId: 1,
      actorId: 10,
      visibleProjectCount: 6,
      totalProjectCount: 8,
    },
    kpis: [
      makeMetric('total_projects', 8),
      makeMetric('active_projects', 5),
      makeMetric('at_risk_projects', 2, 'count', 'ok', [
        { code: 'SOURCE_STALE', message: '风险汇总源已过期', metricKey: 'at_risk_projects' },
      ]),
      makeMetric('blocked_projects', 1),
      makeMetric('overall_progress_avg', 61, 'percent'),
      makeMetric('delivery_on_track_percent', 88, 'percent'),
      makeMetric('overdue_project_percent', 12, 'percent'),
    ],
    trafficLight: makeTrafficLight(),
    freshness: [
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.PROJECT_DASHBOARD,
        lastUpdatedAt: '2026-09-01T07:30:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
      },
    ],
    warnings: [
      {
        code: 'SOURCE_STALE',
        message: '预测数据源已过期',
        metricKey: 'prediction_high_severity_percent',
      },
    ],
    ...overrides,
  }
}

/** 空内容摘要（无 KPI/交通灯/告警——组合空态三态语义）。 */
function makeEmptySummary(): PortfolioDashboardSummary {
  return makeSummary({ kpis: [], trafficLight: null, warnings: [], freshness: [] })
}

function makeInvestCatalogueBody() {
  return {
    data: {
      nonFinancialBasis: ['project_count', 'planned_effort_hours'],
      unsupportedFinancialBasis: ['budget_amount'],
      dimensions: ['project_type', 'status'],
      displayModes: ['donut'],
      topN: { default: 10, max: 20 },
      trendWindows: ['last_30_days', 'last_90_days'],
      metricVersion: 'pmo-investment-distribution.v1',
    },
  }
}

function makeInvestSummaryBody() {
  return {
    data: {
      meta: {
        calculatedAt: '2026-09-01T08:00:00.000Z',
        metricVersion: 'pmo-investment-distribution.v1',
        organizationId: 1,
        actorId: 10,
        visibleProjectCount: 3,
        basis: 'project_count',
        dimension: 'project_type',
        displayMode: 'donut',
        totalBasisValue: 3,
        sourceFreshness: [],
      },
      buckets: [],
      warnings: [],
    },
  }
}

function createBackend() {
  const route = (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/portfolio-dashboard') && method === 'GET') {
      return jsonResponse(200, { data: makeSummary() })
    }
    if (path.startsWith('/pmo/investment-distribution/catalogue')) {
      return jsonResponse(200, makeInvestCatalogueBody())
    }
    if (path.startsWith('/pmo/investment-distribution/trends')) {
      return jsonResponse(200, {
        meta: makeInvestSummaryBody().data.meta,
        data: [],
        warnings: [],
      })
    }
    if (path.startsWith('/pmo/investment-distribution')) {
      return jsonResponse(200, makeInvestSummaryBody())
    }
    return null
  }
  return { route }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  setAuth(['portfolio:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// RBAC 守卫与组织上下文（零请求）
// ---------------------------------------------------------------------------
describe('/next/pmo 页面：RBAC 守卫与组织上下文', () => {
  test('无 portfolio:view：受限横幅渲染、工作台不挂载且业务接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<PmoPortfolioOverviewPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看 PMO 组合总览的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-portfolio-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('未选择组织：中性引导态渲染且零请求（RL-05）', async () => {
    // 无任何组织成员关系 + JWT 无组织声明 → 有效租户上下文为 null → 引导态。
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['portfolio:view'],
    })
    const { records } = installFetchRouter(() => null)
    renderPage(<PmoPortfolioOverviewPage />)

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 授权装配：骨架屏 / 内容 / 空态
// ---------------------------------------------------------------------------
describe('/next/pmo 页面：授权装配与三态', () => {
  test('加载中渲染几何匹配骨架屏（aria-busy），完成后再现内容，摘要单请求带双 include 参数', async () => {
    const backend = createBackend()
    const gate = deferred<Response>()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/pmo/portfolio-dashboard')) return gate.promise
      return backend.route(path, method)
    })
    renderPage(<PmoPortfolioOverviewPage />)

    // 骨架屏阶段：无空态闪烁（摘要挂起时容器不渲染任何内容卡）
    const skeleton = document.querySelector('[data-pmo-portfolio-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-pmo-portfolio-workspace]')).toBeNull()

    gate.resolve(jsonResponse(200, { data: makeSummary() }))
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-portfolio-skeleton]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'PMO 组合总览' })).toBeInTheDocument()
    expect(screen.getByText(/共 6 个可见项目/)).toBeInTheDocument()

    await waitFor(() => {
      const summaryGets = records.filter((record) =>
        record.url.startsWith('/pmo/portfolio-dashboard'),
      )
      expect(summaryGets.length).toBeGreaterThanOrEqual(1)
      expect(summaryGets[0]!.url).toContain('includeTrafficLight=true')
      expect(summaryGets[0]!.url).toContain('includeFreshness=true')
    })
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('KPI/交通灯/告警/投入分布区块渲染且全程零写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    // KPI：项目总数/平均进度 percent 单位/风险项目标签
    expect(document.querySelector('[data-pmo-kpi="total_projects"]')).not.toBeNull()
    expect(screen.getByText('项目总数')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-kpi-value]')?.textContent).toContain('8')
    const kpiValues = Array.from(document.querySelectorAll('[data-pmo-kpi-value]')).map(
      (node) => node.textContent,
    )
    expect(kpiValues).toContain('61%')
    expect(kpiValues).toContain('88%')
    // 交通灯四色计数
    await waitFor(() => expect(document.querySelector('[data-pmo-traffic-summary]')).not.toBeNull())
    expect(document.querySelector('[data-pmo-traffic-count="red"]')?.textContent).toContain('2')
    expect(document.querySelector('[data-pmo-traffic-count="green"]')?.textContent).toContain('3')
    // 告警条目 + 数据新鲜度
    expect(document.querySelector('[data-pmo-alert-item]')?.textContent).toContain(
      '预测数据源已过期',
    )
    expect(document.querySelector('[data-pmo-freshness-item]')).not.toBeNull()
    // 投入分布区块挂载
    await waitFor(() => expect(document.querySelector('[data-pmo-invest-section]')).not.toBeNull())
    await waitFor(() => expect(writeMethods(records)).toHaveLength(0))
  })

  test('空内容摘要：组合空态与区块空态呈现，不闪烁骨架', async () => {
    const route = (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path.startsWith('/pmo/portfolio-dashboard')) {
        return jsonResponse(200, { data: makeEmptySummary() })
      }
      if (path.startsWith('/pmo/investment-distribution/catalogue')) {
        return jsonResponse(200, makeInvestCatalogueBody())
      }
      if (path.startsWith('/pmo/investment-distribution/trends')) {
        return jsonResponse(200, {
          meta: makeInvestSummaryBody().data.meta,
          data: [],
          warnings: [],
        })
      }
      if (path.startsWith('/pmo/investment-distribution')) {
        return jsonResponse(200, makeInvestSummaryBody())
      }
      return null
    }
    const { records } = installFetchRouter(route)
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-overview-empty]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-kpi-grid]')).toBeNull()
    expect(document.querySelector('[data-pmo-traffic-summary]')).toBeNull()
    // 全空内容走单一组合空态，区块级空态不再叠加
    expect(document.querySelector('[data-pmo-alerts-card]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('5xx 错误卡 → 重新载入重试成功闭环', async () => {
    let failedOnce = false
    const backend = createBackend()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/pmo/portfolio-dashboard') && !failedOnce) {
        failedOnce = true
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '后端繁忙' } })
      }
      return backend.route(path, method)
    })
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() => expect(document.querySelector('[data-pmo-portfolio-error]')).not.toBeNull())
    expect(screen.getByText('PMO 组合总览加载失败')).toBeInTheDocument()
    expect(screen.queryByText('数据不存在或当前会话无权访问')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-portfolio-error]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('403 摘要响应：中性受限态（不泄露区分性线索）并提供返回角色首页', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (method !== 'GET') return null
      if (path.startsWith('/pmo/portfolio-dashboard')) {
        return jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: '无权访问' } })
      }
      return null
    })
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() => expect(document.querySelector('[data-pmo-portfolio-error]')).not.toBeNull())
    expect(screen.getByText('组合态势数据不可用')).toBeInTheDocument()
    expect(screen.getByText(/数据不存在或当前会话无权访问/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
    expect(writeMethods(records)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tab 与子导航（权限显隐 + 路由目标）
// ---------------------------------------------------------------------------
describe('/next/pmo 页面：Tab 与子导航动线', () => {
  test('分组视图 Tab 与子导航路由跳转新轨目标；决策按钮按 pmo_decision:view 显隐', async () => {
    setAuth(['portfolio:view', 'pmo_decision:view'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    // 决策按钮（具备 pmo_decision:view）
    expect(document.querySelector('[data-pmo-nav-decisions]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '分组视图' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/grouping-views')

    navMock.push.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '优先级评分' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/priority-scoring')

    navMock.push.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '组织资源池' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/organization/resource-pool')

    navMock.push.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '决策工作台' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/decisions')

    navMock.push.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('无 pmo_decision:view：决策工作台按钮物理隐藏（RL-06）', async () => {
    setAuth(['portfolio:view'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-nav-decisions]')).toBeNull()
    expect(screen.queryByRole('button', { name: '决策工作台' })).toBeNull()
  })
})
