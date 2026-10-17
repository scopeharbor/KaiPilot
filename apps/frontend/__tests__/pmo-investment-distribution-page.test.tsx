/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PmoPortfolioDashboardPage from '@/app/(dashboard)/pmo/page'
import { usePermissions } from '@/hooks/use-permissions'
import { usePortfolioSummary } from '@/hooks/use-portfolio-dashboard'
import {
  useInvestmentDistributionCatalogue,
  useInvestmentDistributionDrillDown,
  useInvestmentDistributionSummary,
} from '@/hooks/use-pmo-investment-distribution'
import type {
  PmoInvestmentBucket,
  PmoInvestmentDistributionSummary,
  PmoInvestmentDisplayMode,
} from '@aiproj/types'
import type { Mock } from 'vitest'

/**
 * PMO 投入分布工作台区块测试（v3-pmo-investment-distribution §5.4/§5.6/§5.8）。
 * 覆盖：授权/未授权、加载、空组合、API 错误、来源过期、脱敏桶、
 * 财务 unsupported、口径/维度/展示模式切换、下钻二次授权与无不安全链接。
 */

vi.mock('@/hooks/use-permissions', () => ({ usePermissions: vi.fn() }))
vi.mock('@/hooks/use-portfolio-dashboard', () => ({ usePortfolioSummary: vi.fn() }))
vi.mock('@/hooks/use-pmo-investment-distribution', () => ({
  useInvestmentDistributionCatalogue: vi.fn(),
  useInvestmentDistributionSummary: vi.fn(),
  useInvestmentDistributionDrillDown: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }))

vi.mock('@/components/ui/Select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      <button
        type="button"
        data-testid={`select-change-${value}`}
        onClick={() => onValueChange?.('__next__')}
      >
        change
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid="select-item" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <div />,
}))

vi.mock('@/components/ui/Sheet', () => ({
  Sheet: ({ children, open }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: any) => <div data-testid="sheet-content">{children}</div>,
  SheetDescription: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Alert', () => ({
  Alert: ({ children, variant }: any) => (
    <div role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant, className }: any) => (
    <span data-testid="badge" className={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }: any) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function bucket(overrides: Partial<PmoInvestmentBucket> = {}): PmoInvestmentBucket {
  return {
    key: 'delivery',
    label: '交付',
    total: 60,
    percent: 60,
    projectCount: 6,
    status: 'ok',
    evidenceRefs: [],
    warnings: [],
    ...overrides,
  }
}

function summary(
  overrides: Partial<PmoInvestmentDistributionSummary> = {},
): PmoInvestmentDistributionSummary {
  return {
    meta: {
      calculatedAt: '2026-07-28T10:00:00.000Z',
      metricVersion: 'pmo-investment-distribution.v1',
      organizationId: 1,
      actorId: 7,
      visibleProjectCount: 10,
      basis: 'project_count',
      dimension: 'project_type',
      displayMode: 'donut',
      totalBasisValue: 100,
      sourceFreshness: [
        {
          source: 'project',
          lastUpdatedAt: '2026-07-28T09:00:00.000Z',
          isStale: false,
          staleThresholdMinutes: 60,
        },
      ],
      inputSignatureHash: 'abc12345',
    },
    buckets: [
      bucket(),
      bucket({ key: 'research', label: '研究', total: 40, percent: 40, projectCount: 4 }),
    ],
    warnings: [],
    ...overrides,
  }
}

const catalogue = {
  nonFinancialBasis: ['project_count', 'estimated_effort_hours'],
  unsupportedFinancialBasis: ['roi'],
  dimensions: ['project_type', 'department'],
  displayModes: ['donut', 'pie', 'horizontal_bar', 'stacked_bar', 'flow', 'matrix'],
  topN: { default: 10, max: 20 },
  trendWindows: ['last_30_days', 'last_90_days'],
  metricVersion: 'pmo-investment-distribution.v1',
}

function setSummaryState(state: {
  data?: PmoInvestmentDistributionSummary | null
  isLoading?: boolean
  error?: unknown
}) {
  ;(useInvestmentDistributionSummary as Mock).mockReturnValue({
    data: state.data ?? null,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
    isFetching: false,
  })
}

function setDrillDownState(data: unknown, isLoading = false) {
  ;(useInvestmentDistributionDrillDown as Mock).mockReturnValue({ data, isLoading, error: null })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoPortfolioDashboardPage />
    </QueryClientProvider>,
  )
}

/** 桶标签同时出现在图例与桶表格中，下钻只点表格行按钮。 */
function clickBucketRow(label: string) {
  const row = screen
    .getAllByRole('button')
    .find((node) => node.textContent?.includes(label) && node.textContent?.includes('%'))
  if (!row) throw new Error(`未找到桶行按钮：${label}`)
  fireEvent.click(row)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
  ;(usePortfolioSummary as Mock).mockReturnValue({ data: null, isLoading: false, error: null })
  ;(useInvestmentDistributionCatalogue as Mock).mockReturnValue({ data: catalogue })
  setSummaryState({ data: summary() })
  setDrillDownState(null)
})

// ─── §5.4 页面状态 ────────────────────────────────────────────────────────────

describe('PMO 投入分布区块 — 页面状态（§5.4）', () => {
  it('授权用户首屏直接看到口径、维度与分布桶', () => {
    renderPage()
    expect(screen.getByText('投入分布')).toBeTruthy()
    expect(screen.getByText(/项目数 · 项目类型 · 10 个可见项目/)).toBeTruthy()
    expect(screen.getAllByText('交付').length).toBeGreaterThan(0)
    expect(screen.getAllByText('研究').length).toBeGreaterThan(0)
  })

  it('无 portfolio:view 权限时整页降级且不渲染投入分布', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => false })
    renderPage()
    expect(screen.getByText('您没有 PMO 组合 Dashboard 访问权限。')).toBeTruthy()
    expect(screen.queryByText('投入分布')).toBeNull()
  })

  it('加载中显示骨架屏而非空图表', () => {
    setSummaryState({ data: null, isLoading: true })
    renderPage()
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })

  it('空组合显示明确空态而非 0 值图表', () => {
    setSummaryState({
      data: summary({
        buckets: [],
        warnings: [{ code: 'EMPTY_PORTFOLIO', message: '当前范围内没有可见项目' }],
      }),
    })
    renderPage()
    expect(screen.getByText('暂无可展示的投入分布')).toBeTruthy()
    expect(screen.getByText('当前范围内没有可见项目')).toBeTruthy()
  })

  it('API 错误显示错误提示', () => {
    setSummaryState({ data: null, error: new Error('boom') })
    renderPage()
    expect(screen.getByText('加载投入分布失败，请稍后重试。')).toBeTruthy()
  })

  it('来源过期时显示过期徽标', () => {
    setSummaryState({
      data: summary({
        meta: {
          ...summary().meta,
          sourceFreshness: [
            {
              source: 'task_requirement',
              lastUpdatedAt: '2026-07-01T00:00:00.000Z',
              isStale: true,
              staleThresholdMinutes: 60,
            },
          ],
        },
        warnings: [{ code: 'SOURCE_STALE', message: '来源已过期', source: 'task_requirement' }],
      }),
    })
    renderPage()
    expect(screen.getByText('来源过期')).toBeTruthy()
    expect(
      screen.getAllByTestId('badge').some((b) => b.textContent?.includes('SOURCE_STALE')),
    ).toBe(true)
  })

  it('脱敏桶显示「已脱敏」且不显示隐藏数量', () => {
    setSummaryState({
      data: summary({
        buckets: [
          bucket({
            key: 'other',
            label: '其他',
            total: null,
            percent: 0,
            projectCount: null,
            status: 'redacted',
            warnings: [{ code: 'LOW_CARDINALITY_REDACTED', message: '低基数桶已合并' }],
          }),
        ],
        warnings: [{ code: 'PERMISSION_REDACTED', message: '结果已脱敏', dimension: 'department' }],
      }),
    })
    renderPage()
    expect(screen.getByText('已脱敏')).toBeTruthy()
    expect(screen.getByText('不可用')).toBeTruthy()
    expect(screen.queryByText(/个项目/)).toBeNull()
  })

  it('财务口径返回 unsupported 时显示不可用状态而非 0 值图表', () => {
    setSummaryState({
      data: summary({
        meta: { ...summary().meta, basis: 'roi', totalBasisValue: null },
        buckets: [],
        warnings: [
          {
            code: 'FINANCIAL_BASIS_UNSUPPORTED',
            message: '财务、预算、成本、收益和 ROI 口径不在当前 PMO 投入分布范围内',
            basis: 'roi',
          },
        ],
      }),
    })
    renderPage()
    expect(screen.getByText('该财务口径当前不可用')).toBeTruthy()
    expect(
      screen.getByText('财务、预算、成本、收益和 ROI 口径不在当前 PMO 投入分布范围内'),
    ).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })
})

// ─── §5.6 控件与下钻 ──────────────────────────────────────────────────────────

describe('PMO 投入分布区块 — 控件与下钻（§5.6）', () => {
  it('口径/维度/展示/Top-N 四组控件都由 catalogue 驱动', () => {
    renderPage()
    const values = screen.getAllByTestId('select').map((node) => node.getAttribute('data-value'))
    expect(values).toEqual(['project_count', 'project_type', 'donut', '10'])

    const items = screen
      .getAllByTestId('select-item')
      .map((node) => node.getAttribute('data-value'))
    expect(items).toContain('estimated_effort_hours')
    expect(items).toContain('roi')
    expect(items).toContain('department')
    for (const mode of ['donut', 'pie', 'horizontal_bar', 'stacked_bar', 'flow', 'matrix']) {
      expect(items).toContain(mode)
    }
  })

  it('切换口径会触发新的 summary 查询', () => {
    renderPage()
    const callsBefore = (useInvestmentDistributionSummary as Mock).mock.calls.length
    fireEvent.click(screen.getByTestId('select-change-project_count'))
    const calls = (useInvestmentDistributionSummary as Mock).mock.calls
    expect(calls.length).toBeGreaterThan(callsBefore)
    expect(calls[calls.length - 1]![0]).toMatchObject({ basis: '__next__' })
  })

  it('切换维度会触发新的 summary 查询', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('select-change-project_type'))
    const calls = (useInvestmentDistributionSummary as Mock).mock.calls
    expect(calls[calls.length - 1]![0]).toMatchObject({ dimension: '__next__' })
  })

  it('桶行展示总量与占比，并可打开下钻抽屉', () => {
    setDrillDownState({
      meta: summary().meta,
      data: [
        {
          projectId: 1,
          projectName: '交付项目 A',
          bucketKey: 'delivery',
          basisValue: 30,
          status: 'ok',
          evidenceRefs: [],
          warnings: [],
        },
      ],
      warnings: [],
    })
    renderPage()
    expect(screen.getByText('60% · 6 个项目')).toBeTruthy()

    clickBucketRow('交付')
    const sheet = screen.getByTestId('sheet-content')
    expect(within(sheet).getByText('交付项目 A')).toBeTruthy()
    expect(useInvestmentDistributionDrillDown).toHaveBeenLastCalledWith(
      expect.objectContaining({ bucketKey: 'delivery' }),
    )
  })

  it('下钻二次授权失败时显示空态而不泄露受限项目', () => {
    setDrillDownState({ meta: summary().meta, data: [], warnings: [] })
    renderPage()
    clickBucketRow('交付')
    const sheet = screen.getByTestId('sheet-content')
    expect(within(sheet).getByText('没有可下钻的项目')).toBeTruthy()
    expect(within(sheet).getByText('该桶可能已脱敏，或当前用户没有项目明细权限。')).toBeTruthy()
  })

  it('区块内不渲染任何外部锚点链接', () => {
    const { container } = renderPage()
    const anchors = Array.from(container.querySelectorAll('a'))
    expect(
      anchors.filter((a) => /^(https?:|javascript:)/i.test(a.getAttribute('href') ?? '')),
    ).toHaveLength(0)
  })
})

// ─── §5.8 图表 ────────────────────────────────────────────────────────────────

describe('PMO 投入分布图表 — 五种展示模式（§5.8）', () => {
  const modes: PmoInvestmentDisplayMode[] = [
    'donut',
    'pie',
    'horizontal_bar',
    'stacked_bar',
    'flow',
    'matrix',
  ]

  for (const mode of modes) {
    it(`${mode} 模式渲染同一份 normalized 分布且不抛错`, () => {
      setSummaryState({ data: summary({ meta: { ...summary().meta, displayMode: mode } }) })
      const { container } = renderPage()
      expect(container.textContent).toContain('交付')
      expect(container.textContent).toContain('研究')
    })
  }

  it('长标签被截断且不撑破控件', () => {
    const longLabel = '特别长的战略主题标签名称需要在图表中被截断处理'
    setSummaryState({
      data: summary({ buckets: [bucket({ key: 'long', label: longLabel })] }),
    })
    const { container } = renderPage()
    // 图例使用截断后的短标签；桶表格保留完整标签但走 truncate 样式
    expect(container.textContent).toContain(`${longLabel.slice(0, 11)}…`)
    const truncated = container.querySelectorAll('.truncate')
    expect(truncated.length).toBeGreaterThan(0)
  })

  it('小桶与 other 桶同时存在时全部可见', () => {
    setSummaryState({
      data: summary({
        buckets: [
          bucket({ key: 'delivery', label: '交付', total: 95, percent: 95, projectCount: 19 }),
          bucket({ key: 'tiny', label: '试点', total: 1, percent: 1, projectCount: 1 }),
          bucket({
            key: 'other',
            label: '其他',
            total: null,
            percent: 4,
            projectCount: null,
            status: 'redacted',
          }),
        ],
      }),
    })
    renderPage()
    expect(screen.getAllByText('交付').length).toBeGreaterThan(0)
    expect(screen.getAllByText('试点').length).toBeGreaterThan(0)
    expect(screen.getAllByText('其他').length).toBeGreaterThan(0)
  })

  it('空数据不渲染图表容器', () => {
    setSummaryState({ data: summary({ buckets: [] }) })
    const { container } = renderPage()
    expect(container.textContent).toContain('暂无可展示的投入分布')
  })
})

// ─── §5.10 响应式 / 密度 / 主题 ───────────────────────────────────────────────

describe('PMO 投入分布区块 — 响应式与主题契约（§5.10）', () => {
  it('控件区在窄屏单列、平板两列、桌面四列', () => {
    const { container } = renderPage()
    const controlGrid = container.querySelector('.grid.gap-3.sm\\:grid-cols-2.lg\\:grid-cols-4')
    expect(controlGrid).toBeTruthy()
  })

  it('图表与桶表格在窄屏堆叠、桌面并排', () => {
    const { container } = renderPage()
    const layout = Array.from(container.querySelectorAll('div')).find((node) =>
      node.className.includes('lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]'),
    )
    expect(layout).toBeTruthy()
    expect(layout!.className).toContain('grid')
  })

  it('桶行满足最小可点区域且长文本走 truncate 不溢出', () => {
    const { container } = renderPage()
    const rows = Array.from(container.querySelectorAll('button')).filter((node) =>
      node.className.includes('min-h-12'),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.querySelector('.truncate')).toBeTruthy()
    }
  })

  it('颜色与圆角走设计令牌（支持浅/深色与紧凑密度切换）', () => {
    const { container } = renderPage()
    const html = container.innerHTML
    expect(html).toContain('var(--radius-md)')
    expect(html).toContain('border-border')
  })
})
