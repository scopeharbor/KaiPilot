import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NextStrategyExecutionCockpitPage from '@/app/(next)/next/strategy-execution-cockpit/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import type { CockpitSummary } from '@aiproj/types'

// Mock next/navigation
const routerMock = { replace: vi.fn(), push: vi.fn() }
let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => currentSearchParams,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function makeMockCockpitSummary(overrides: Partial<CockpitSummary> = {}): CockpitSummary {
  return {
    meta: {
      calculatedAt: '2026-09-11T12:00:00.000Z',
      metricVersion: 'strategy-execution-cockpit.v1.0.0',
      organizationId: 1,
      actorId: 7,
      cycleId: 1,
      overallStatus: 'ready',
      visibleObjectiveCount: 2,
      visibleKeyResultCount: 4,
      mappedProjectCount: 2,
      restrictedObjectiveCount: 0,
      restrictedMappingCount: 0,
      includes: ['objective_matrix', 'attention'],
      attentionLimit: 10,
      freshnessWindowMinutes: 4320,
      inputSignatureHash: 'test-signature-hash',
    },
    cycleContext: {
      cycleId: 1,
      title: '2026 Q3 全局战略对齐',
      status: 'active',
      startDate: '2026-07-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
      elapsedPercent: 75,
      daysRemaining: 19,
    },
    kpis: [
      {
        key: 'cockpit_total_objectives',
        value: 2,
        unit: 'count',
        source: 'okr_objective',
        status: 'available',
      },
      {
        key: 'cockpit_completed_objectives',
        value: 1,
        unit: 'count',
        source: 'computed',
        status: 'available',
      },
      {
        key: 'cockpit_strategy_progress_avg',
        value: 65,
        unit: 'avg',
        source: 'computed',
        status: 'available',
      },
      {
        key: 'cockpit_at_risk_objectives',
        value: 1,
        unit: 'count',
        source: 'okr_objective',
        status: 'available',
      },
      {
        key: 'cockpit_mapping_coverage_percent',
        value: 85,
        unit: 'percent',
        source: 'okr_mapping',
        status: 'available',
      },
    ],
    objectiveRows: [
      {
        objectiveId: 101,
        objectiveTitle: '打造新一代纸光长卷阅览引擎',
        scope: 'organization',
        status: 'active',
        progress: 80,
        confidence: 'high',
        keyResultCount: 2,
        behindKeyResultCount: 0,
        mappedProjects: [
          {
            kind: 'direct_project_contribution',
            projectId: 1,
            weight: 1,
            contributionPercent: 50,
            sourceVersion: 'v1',
            target: { kind: 'pmo_portfolio', href: '/projects/1', authorized: true },
            authorized: true,
          },
        ],
        coveragePercent: 100,
        executionHealth: 'on_track',
        priorityBand: 'high',
        investmentAlignment: 'aligned',
        resourceRiskPressure: null,
        attentionReasons: [],
        warnings: [],
        target: { kind: 'okr_objective', href: '/okrs/101', authorized: true },
      },
      {
        objectiveId: 102,
        objectiveTitle: '跨境支付网关升级与清算联调',
        scope: 'team',
        status: 'active',
        progress: 50,
        confidence: 'low',
        keyResultCount: 2,
        behindKeyResultCount: 1,
        mappedProjects: [],
        coveragePercent: 70,
        executionHealth: 'at_risk',
        priorityBand: 'high',
        investmentAlignment: 'mismatch',
        resourceRiskPressure: 3,
        attentionReasons: ['STRATEGY_PROGRESS_AT_RISK'],
        warnings: [],
        target: { kind: 'okr_objective', href: '/okrs/102', authorized: true },
      },
    ],
    attention: [
      {
        id: 'attn-102',
        severity: 'critical',
        reasonCode: 'STRATEGY_PROGRESS_AT_RISK',
        ruleVersion: '1.0',
        basis: '跨境支付联调滞后导致目标进度偏离基线 25%',
        message: '跨境支付网关升级与清算联调进展偏离，影响上线窗口',
        objectiveId: 102,
        projectIds: [1],
        sourceFreshness: [],
        warnings: [],
        target: { kind: 'okr_objective', href: '/okrs/102', authorized: true },
      },
    ],
    portfolioTrafficLight: {
      available: true,
      forbidden: false,
      redCount: 1,
      yellowCount: 0,
      greenCount: 1,
      grayCount: 0,
      freshness: {
        source: 'portfolio_traffic_light',
        status: 'available',
        lastUpdatedAt: null,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      warnings: [],
    },
    priorityInvestment: {
      available: true,
      forbidden: false,
      unsupportedFinancial: false,
      priorityMismatchCount: 1,
      investmentMismatchCount: 0,
      basis: 'okr_priority',
      freshness: {
        source: 'portfolio_priority',
        status: 'available',
        lastUpdatedAt: null,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      warnings: [],
    },
    resourceRisk: {
      available: true,
      forbidden: false,
      pressureCount: 1,
      freshness: {
        source: 'resource_risk',
        status: 'available',
        lastUpdatedAt: null,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      warnings: [],
    },
    sourceFreshness: [
      {
        source: 'okr_objective',
        status: 'available',
        lastUpdatedAt: '2026-09-11T10:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
      },
    ],
    warnings: [],
    ...overrides,
  }
}

describe('战略执行驾驶舱新轨页面装配与端到端测试（任务 1.9 / 1.10）', () => {
  let queryClient: QueryClient
  const fetchRecords: Array<{ method: string; url: string }> = []
  let mockSummaryData: CockpitSummary | null = null
  let mockFetchShouldFail = false

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    })

    fetchRecords.length = 0
    mockSummaryData = makeMockCockpitSummary()
    mockFetchShouldFail = false
    currentSearchParams = new URLSearchParams()
    routerMock.replace.mockClear()
    routerMock.push.mockClear()

    useNextTrackStore.setState({ immersionTier: null })
    document.documentElement.removeAttribute('data-immersion')

    // 默认已登录、已选组织 1、持有 strategy:view 权限
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'leader@example.com',
        fullName: '战略总监',
        organizations: [{ id: 1, name: '集团总部', slug: 'headquarters', role: 'admin' }],
      },
      currentOrganizationId: 1,
      permissions: ['strategy:view'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    // 全局 fetch stub（不 mock @/lib/api/*，保持真实数据传输契约）
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      fetchRecords.push({ method, url })

      if (mockFetchShouldFail) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: { code: 'SERVER_ERROR', message: '服务暂时不可用' } }),
        } as Response
      }

      // 战略执行驾驶舱端点拦截
      if (url.includes('/strategy-execution-cockpit')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: mockSummaryData }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      } as Response
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <NextStrategyExecutionCockpitPage />
      </QueryClientProvider>,
    )
  }

  it('完整装配纸光长卷：导言栏、KPI 丝带、目标矩阵与注意力队列数据全部载入', async () => {
    renderPage()

    // 骨架屏先行或数据载入完成
    await waitFor(() => {
      expect(screen.getByText('战略执行驾驶舱')).toBeInTheDocument()
      expect(screen.getByTestId('cycle-title')).toHaveTextContent('2026 Q3 全局战略对齐')
    })

    // 验证 KPI 丝带
    expect(screen.getByTestId('kpi-total-objectives')).toHaveTextContent('2')
    expect(screen.getByTestId('kpi-average-progress')).toHaveTextContent('65%')
    expect(screen.getByTestId('kpi-mapping-coverage')).toHaveTextContent('85%')

    // 验证目标矩阵数据行
    expect(screen.getByText('打造新一代纸光长卷阅览引擎')).toBeInTheDocument()
    expect(screen.getByText('跨境支付网关升级与清算联调')).toBeInTheDocument()

    // 验证注意力队列卡片
    expect(screen.getByText('战略注意力队列')).toBeInTheDocument()
    expect(screen.getByText(/跨境支付网关升级与清算联调进展偏离，影响上线窗口/)).toBeInTheDocument()

    // 严苛断言：数据契约走真实 fetch GET，且零网络写操作（RL-01）
    const getCalls = fetchRecords.filter((r) => r.method === 'GET')
    expect(getCalls.some((r) => r.url.includes('/strategy-execution-cockpit'))).toBe(true)
    const writeCalls = fetchRecords.filter((r) =>
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method),
    )
    expect(writeCalls).toHaveLength(0)
  })

  it('未选择组织时呈现友好的引导提示态且零 API 请求', () => {
    useAuthStore.setState({ currentOrganizationId: null })
    renderPage()

    expect(screen.getByTestId('cockpit-no-organization')).toBeInTheDocument()
    expect(screen.getByText(/请先选择组织以查看战略执行驾驶舱/)).toBeInTheDocument()

    // 零 cockpit 请求
    const cockpitCalls = fetchRecords.filter((r) => r.url.includes('/strategy-execution-cockpit'))
    expect(cockpitCalls).toHaveLength(0)
  })

  it('缺少 strategy:view 权限时拦截并呈现中性无权访问提示', () => {
    useAuthStore.setState({ permissions: [] })
    renderPage()

    expect(screen.getByTestId('cockpit-permission-denied')).toBeInTheDocument()
    expect(screen.getByText(/无权访问战略执行驾驶舱/)).toBeInTheDocument()
    expect(screen.getByText(/需要 strategy:view 权限方可查看战略执行驾驶舱/)).toBeInTheDocument()

    // 零 cockpit 请求
    const cockpitCalls = fetchRecords.filter((r) => r.url.includes('/strategy-execution-cockpit'))
    expect(cockpitCalls).toHaveLength(0)
  })

  it('数据异常时展示错误重试卡片，点击重新载入触发 refetch 闭环', async () => {
    mockFetchShouldFail = true
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cockpit-error-card')).toBeInTheDocument()
      expect(screen.getByText(/驾驶舱数据暂不可用，请稍后重试/)).toBeInTheDocument()
    })

    // 恢复网络并点击重试按钮
    mockFetchShouldFail = false
    const retryBtn = screen.getByTestId('cockpit-retry-btn')
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('打造新一代纸光长卷阅览引擎')).toBeInTheDocument()
    })
  })

  it('精确档（data-immersion="precise"）下保持纯平纸面降级', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('打造新一代纸光长卷阅览引擎')).toBeInTheDocument()
    })

    const rootContainer = document.querySelector('[data-role-scroll-container="true"]')
    expect(rootContainer).toHaveAttribute('data-immersion', 'precise')
    expect(rootContainer?.querySelector('.max-w-5xl')?.className).toContain('shadow-none')
  })

  it('点击 AI 归因摘要按钮滑出只读抽屉，Esc 键关闭', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('跨境支付网关升级与清算联调')).toBeInTheDocument()
    })

    // 点击注意力卡片上的 AI 归因按钮
    const aiBtn = screen.getByTestId('ai-attribution-attn-attn-102')
    fireEvent.click(aiBtn)

    // 抽屉展开
    expect(screen.getByRole('dialog', { name: 'AI 战略归因摘要' })).toBeInTheDocument()
    expect(screen.getByText('瓶颈资源归因分析')).toBeInTheDocument()

    // 按 Esc 键关闭
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('点击重置筛选按钮调用 router.replace 重置 URL 参数', async () => {
    currentSearchParams = new URLSearchParams('status=active&sort=risk')
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('reset-filters-btn')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('reset-filters-btn'))
    expect(routerMock.replace).toHaveBeenCalledWith('/next/strategy-execution-cockpit', {
      scroll: false,
    })
  })
})
