import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import type { CockpitSummary } from '@aiproj/types'
import StrategyExecutionCockpitPage from '@/app/(dashboard)/strategy-execution-cockpit/page'
import { useStrategyExecutionCockpit } from '@/hooks/use-strategy-execution-cockpit'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

vi.mock('@/hooks/use-strategy-execution-cockpit', () => ({
  useStrategyExecutionCockpit: vi.fn(),
}))
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: vi.fn(() => 1),
}))
let searchParamsMock = new URLSearchParams('')
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => searchParamsMock,
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

function makeSummary(): CockpitSummary {
  return {
    meta: {
      calculatedAt: '2026-07-30T12:00:00.000Z',
      metricVersion: 'strategy-execution-cockpit.v1.0.0',
      organizationId: 1,
      actorId: 7,
      cycleId: 1,
      overallStatus: 'degraded',
      visibleObjectiveCount: 1,
      visibleKeyResultCount: 1,
      mappedProjectCount: 1,
      restrictedObjectiveCount: 0,
      restrictedMappingCount: 0,
      includes: ['objective_matrix', 'attention'],
      attentionLimit: 10,
      freshnessWindowMinutes: 4320,
      inputSignatureHash: 'abc',
    },
    cycleContext: {
      cycleId: 1,
      title: '2026 上半年',
      status: 'active',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-06-30T00:00:00.000Z',
      elapsedPercent: 90,
      daysRemaining: 1,
    },
    kpis: [
      {
        key: 'cockpit_total_objectives',
        value: 1,
        unit: 'count',
        source: 'okr_objective',
        status: 'available',
      },
    ],
    objectiveRows: [
      {
        objectiveId: 1,
        objectiveTitle: '战略目标 A',
        scope: 'team',
        status: 'active',
        progress: 30,
        confidence: 'medium',
        keyResultCount: 1,
        behindKeyResultCount: 0,
        mappedProjects: [
          {
            kind: 'direct_project_contribution',
            projectId: 100,
            weight: 1,
            contributionPercent: 20,
            sourceVersion: 'v1',
            target: { kind: 'pmo_portfolio', href: '/projects/100', authorized: true },
            authorized: true,
          },
        ],
        coveragePercent: 20,
        executionHealth: 'on_track',
        priorityBand: 'high',
        investmentAlignment: 'unknown',
        resourceRiskPressure: null,
        attentionReasons: [],
        warnings: [],
        target: {
          kind: 'okr_objective',
          href: '/organizations/1/okrs?objective=1',
          authorized: true,
        },
      },
      {
        objectiveId: 2,
        objectiveTitle: '战略目标 B',
        scope: 'project',
        status: 'active',
        progress: 80,
        confidence: 'high',
        keyResultCount: 2,
        behindKeyResultCount: 0,
        mappedProjects: [
          {
            kind: 'direct_project_contribution',
            projectId: 101,
            weight: 1,
            contributionPercent: 60,
            sourceVersion: 'v1',
            target: { kind: 'pmo_portfolio', href: '/projects/101', authorized: true },
            authorized: true,
          },
        ],
        coveragePercent: 60,
        executionHealth: 'on_track',
        priorityBand: 'medium',
        investmentAlignment: 'unknown',
        resourceRiskPressure: null,
        attentionReasons: [],
        warnings: [],
        target: {
          kind: 'okr_objective',
          href: '/organizations/1/okrs?objective=2',
          authorized: true,
        },
      },
    ],
    attention: [
      {
        id: '1:EXECUTION_COVERAGE_GAP',
        severity: 'warning' as const,
        reasonCode: 'EXECUTION_COVERAGE_GAP' as const,
        message: '高优先级目标的显式执行覆盖不足',
        basis: 'no active explicit mapping coverage',
        ruleVersion: 'cockpit-attention-rules.v1',
        objectiveId: 1,
        projectIds: [],
        sourceFreshness: [],
        target: {
          kind: 'okr_objective',
          href: '/organizations/1/okrs?objective=1',
          authorized: true,
        },
        warnings: [],
      },
    ],
    portfolioTrafficLight: {
      available: false,
      forbidden: false,
      redCount: 0,
      yellowCount: 0,
      greenCount: 0,
      grayCount: 0,
      freshness: null,
      warnings: [],
    },
    priorityInvestment: {
      available: false,
      forbidden: false,
      unsupportedFinancial: false,
      priorityMismatchCount: null,
      investmentMismatchCount: null,
      basis: 'unavailable',
      freshness: null,
      warnings: [],
    },
    resourceRisk: {
      available: false,
      forbidden: false,
      pressureCount: null,
      freshness: null,
      warnings: [],
    },
    sourceFreshness: [
      {
        source: 'okr_objective',
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 4320,
        status: 'available',
      },
    ],
    warnings: [
      {
        code: 'EXECUTION_MAPPING_MISSING',
        message: '部分目标缺少显式执行映射',
        source: 'okr_mapping',
      },
    ],
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StrategyExecutionCockpitPage />
    </QueryClientProvider>,
  )
}

function mockCockpit(state: Partial<{ data: CockpitSummary; isLoading: boolean; error: unknown }>) {
  ;(useStrategyExecutionCockpit as Mock).mockReturnValue({
    data: state.data ?? undefined,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(useCurrentOrganizationId as Mock).mockReturnValue(1)
  ;(useStrategyExecutionCockpit as Mock).mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
  })
})

describe('战略执行驾驶舱页 —— 请求状态', () => {
  it('无当前组织时提示先选择组织', () => {
    ;(useCurrentOrganizationId as Mock).mockReturnValue(null)
    renderPage()
    expect(screen.getByText(/请先选择组织/)).toBeTruthy()
  })

  it('加载中显示 loading 而不是数据', () => {
    mockCockpit({ isLoading: true })
    renderPage()
    expect(screen.getByText(/正在加载战略执行驾驶舱/)).toBeTruthy()
    expect(screen.queryByText('目标 → 执行矩阵')).toBeNull()
  })

  it('请求失败显示错误提示', () => {
    mockCockpit({ error: new Error('boom') })
    renderPage()
    expect(screen.getByText(/驾驶舱暂不可用/)).toBeTruthy()
    expect(screen.queryByText('目标 → 执行矩阵')).toBeNull()
  })
})

describe('战略执行驾驶舱页 —— 状态矩阵', () => {
  it('empty 展示显式空态', () => {
    const s = makeSummary()
    s.meta.overallStatus = 'empty'
    mockCockpit({ data: s })
    renderPage()
    expect(screen.getByText('当前组织暂无可见战略范围。')).toBeTruthy()
  })

  it('unavailable 展示不可用提示', () => {
    const s = makeSummary()
    s.meta.overallStatus = 'unavailable'
    mockCockpit({ data: s })
    renderPage()
    expect(screen.getByText('驾驶舱数据暂不可用。')).toBeTruthy()
  })

  it('degraded 展示降级提示', () => {
    const s = makeSummary()
    s.meta.overallStatus = 'degraded'
    mockCockpit({ data: s })
    renderPage()
    expect(screen.getByText('部分来源降级，以下结果可能不完整。')).toBeTruthy()
  })
})

describe('战略执行驾驶舱页 —— 正常状态', () => {
  beforeEach(() => {
    mockCockpit({ data: makeSummary() })
  })

  it('首屏展示 KPI、矩阵与关注区块', () => {
    renderPage()
    expect(screen.getByText('战略执行驾驶舱')).toBeTruthy()
    expect(screen.getByText(/cockpit_total_objectives/)).toBeTruthy()
    expect(screen.getByText('目标 → 执行矩阵')).toBeTruthy()
    expect(screen.getByText('关注队列')).toBeTruthy()
    expect(screen.getByText('组合交通灯')).toBeTruthy()
    expect(screen.getByText('优先级 / 投入')).toBeTruthy()
    expect(screen.getByText('资源 / 风险')).toBeTruthy()
  })

  it('URL 筛选上下文保留给 hook（cycleId→query）', () => {
    searchParamsMock = new URLSearchParams('cycleId=3&include=attention')
    let lastQuery: unknown
    ;(useStrategyExecutionCockpit as Mock).mockImplementation((query: unknown) => {
      lastQuery = query
      return { data: makeSummary(), isLoading: false, error: null }
    })
    renderPage()
    expect((lastQuery as { cycleId?: number })?.cycleId).toBe(3)
    expect((lastQuery as { include?: string[] })?.include).toEqual(['attention'])
  })

  it('页面无 form/写入口（零正式写入）', () => {
    const { container } = renderPage()
    expect(container.querySelector('form')).toBeNull()
    expect(container.textContent).not.toMatch(/确认|提交|一键执行/)
  })

  it('重置筛选按钮满足 44px 触摸与 focus-visible 类', () => {
    renderPage()
    const button = screen.getByRole('button', { name: '重置筛选' })
    expect(button.className).toContain('min-h-[44px]')
    expect(button.className).toContain('focus-visible:outline-2')
  })

  it('目标行提供安全下钻链接', () => {
    renderPage()
    const link = screen.getAllByText('战略目标 A')[0]?.closest('a')
    expect(link?.getAttribute('href')).toBe('/organizations/1/okrs?objective=1')
  })

  it('矩阵含 source badges、排序按钮与窄屏列表', () => {
    renderPage()
    expect(screen.getAllByText(/优先级 high/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/投入 unknown/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/资源\/风险/).length).toBeGreaterThan(0)
    expect(screen.getByText('目标执行概览（窄屏）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '进度' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '覆盖' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关注' })).toBeTruthy()
  })

  it('点击“进度”列头按进度降序排序', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '进度' }))
    const rows = screen.getAllByRole('row').filter((row) => row.textContent?.includes('战略目标'))
    expect(rows[0]?.textContent).toContain('战略目标 B')
  })

  it('下钻链接带 a11y aria-label，摘要区有 role/aria-label', () => {
    renderPage()
    const workspaces = screen.getAllByRole('link')
    expect(workspaces[0]?.getAttribute('aria-label')).toContain('工作台')
    expect(screen.getByLabelText('战略摘要区')).toBeTruthy()
  })

  it('attention 队列展示 severity/reason/basis/ruleVersion 与安全下钻', () => {
    renderPage()
    expect(screen.getByText('warning')).toBeTruthy()
    expect(screen.getByText('EXECUTION_COVERAGE_GAP')).toBeTruthy()
    expect(screen.getByText(/rule cockpit-attention-rules\.v1/)).toBeTruthy()
    expect(screen.getByText('no active explicit mapping coverage')).toBeTruthy()
    const link = screen.getByText('安全查看详情').closest('a')
    expect(link?.getAttribute('href')).toBe('/organizations/1/okrs?objective=1')
  })

  it('无营销式 landing 文案', () => {
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/立即开始|免费试用|了解更多产品/)
  })
})
