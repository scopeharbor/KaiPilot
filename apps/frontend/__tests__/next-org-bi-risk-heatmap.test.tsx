/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.7 —— BI 风险热力工作台组件测试。
 *
 * 覆盖（tasks 3.7 / spec「组织 BI 三镜头」场景）：
 * - 5×5 DOM 网格渲染：色阶等级文字回显、图例双通道、行/列头与「严重/高/中/低」文案；
 * - 脱敏单元中性「不可见」且不出现数值文本（RL-05）；
 * - 筛选（指标/时间窗口/行列维度）重查：GET 以新参数再次发出；
 * - Top 榜按分值渲染、点击唤起摘要抽屉（贡献单元/证据/下钻只读）；
 * - 空态/受限态/错误重试三态；全程零写请求（RL-01，envelope 层方法断言）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RiskHeatmapWorkspace } from '@/components/next/org-bi/RiskHeatmapWorkspace'
import { useAuthStore } from '@/stores/auth-store'
import type { BiRiskHeatmapCell } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 网络层 mock：替换既有 api-client 的 envelope，从真实 lib 路径观测请求
// ---------------------------------------------------------------------------
const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'analyst@example.com',
      fullName: '分析员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
function makeCell(overrides: Partial<BiRiskHeatmapCell>): BiRiskHeatmapCell {
  return {
    rowKey: 'proj-42',
    rowLabel: '开项核心引擎',
    columnKey: 'high',
    columnLabel: '高',
    score: 0.66,
    riskLevel: 'high',
    count: 5,
    delta: null,
    confidence: 0.9,
    contributors: [],
    redactionState: 'none',
    warnings: [],
    evidenceRefs: [],
    sampleCount: 4,
    drilldownTargets: [],
    ...overrides,
  }
}

function defaultCells(): BiRiskHeatmapCell[] {
  return [
    makeCell({
      rowKey: 'proj-42',
      rowLabel: '开项核心引擎',
      columnKey: 'critical',
      columnLabel: '严重',
      score: 0.92,
      riskLevel: 'critical',
      count: 3,
      sampleCount: 12,
      delta: 0.12,
      contributors: [
        { id: 'c1', label: '数据合规审计处罚', kind: 'risk', contributionWeight: 0.7, rank: 1 },
      ],
      evidenceRefs: [
        {
          kind: 'risk_register',
          label: '风险登记册',
          targetKind: 'risk',
          sourceKind: 'risk_register',
        },
      ],
      drilldownTargets: [
        {
          kind: 'project',
          label: '开项核心引擎',
          route: '/next/projects/42',
          requiresPermission: 'project:view',
        },
      ],
    }),
    makeCell({
      rowKey: 'proj-42',
      rowLabel: '开项核心引擎',
      columnKey: 'low',
      columnLabel: '低',
      score: 0.2,
      riskLevel: 'low',
      count: 8,
      sampleCount: 12,
    }),
    makeCell({
      rowKey: 'proj-7',
      rowLabel: '商城重构',
      columnKey: 'critical',
      columnLabel: '严重',
      score: 0.99,
      riskLevel: 'critical',
      count: 1,
      sampleCount: 3,
    }),
    makeCell({
      rowKey: 'proj-7',
      rowLabel: '商城重构',
      columnKey: 'medium',
      columnLabel: '中',
      score: 0.45,
      riskLevel: 'medium',
      count: 2,
      sampleCount: 5,
      redactionState: 'full',
    }),
  ]
}

function metaFor(cells: BiRiskHeatmapCell[]) {
  return {
    organizationId: 1,
    calculatedAt: '2026-09-10T08:00:00.000Z',
    metricVersion: 'bi-risk-heatmap-v1',
    queryShape: {
      metricKey: 'risk_exposure_score',
      window: 'last_90_days',
      rowDimension: 'project',
      columnDimension: 'risk_level',
      filterCount: 0,
      compareWith: 'previous_period',
      sort: 'score',
      sortDir: 'desc' as const,
      page: 1,
      perPage: 50,
    },
    freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
    page: 1,
    perPage: 50,
    total: cells.length,
    totalPages: 1,
  }
}

function respondHeatmap(
  cells: BiRiskHeatmapCell[],
  warnings: Array<{ code: string; message: string }> = [],
) {
  envelopeMock.mockResolvedValue({
    data: cells,
    meta: metaFor(cells),
    warnings,
  })
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RiskHeatmapWorkspace organizationId={1} />
    </QueryClientProvider>,
  )
}

function lastQuery(): URLSearchParams {
  const path = envelopeMock.mock.calls[envelopeMock.mock.calls.length - 1]?.[0] ?? ''
  return new URLSearchParams(path.split('?')[1] ?? '')
}

beforeEach(() => {
  envelopeMock.mockReset()
  setAuth(['org:view', 'portfolio:view'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RiskHeatmapWorkspace：网格色阶双通道渲染（spec 场景「组织成员查看风险热力矩阵」）', () => {
  test('渲染图例、行/列表头与色阶等级文字；点击 Top 项唤起只读摘要抽屉', async () => {
    respondHeatmap(defaultCells())
    renderWorkspace()

    expect(document.querySelector('[data-bi-heat-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())
    expect(screen.getByText('BI 风险热力图')).toBeInTheDocument()

    // 图例双通道：色块 + 文案
    const legend = document.querySelector('[data-bi-heat-legend]')
    expect(legend?.textContent).toContain('严重')
    expect(legend?.textContent).toContain('高')
    expect(legend?.textContent).toContain('中')
    expect(legend?.textContent).toContain('低')
    expect(legend?.textContent).toContain('数据不足')

    // 行列表头与等级/计数文字
    expect(document.querySelectorAll('[data-bi-heat-cell]')).toHaveLength(4)
    expect(screen.getByText('开项核心引擎')).toBeInTheDocument()
    expect(screen.getByText('商城重构')).toBeInTheDocument()
    const criticalCell = document.querySelector('[data-bi-heat-level="critical"]')
    expect(criticalCell?.textContent).toContain('严重')
    expect(criticalCell?.textContent).toContain('3 个')

    // Top 榜排序：score 最高（商城重构 0.99）居首
    const topItems = document.querySelectorAll('[data-bi-heat-top-item]')
    expect(topItems).toHaveLength(4)
    expect(topItems[0]?.textContent).toContain('商城重构 × 严重')

    // 点击带贡献单元/证据/下钻的第二项，打开摘要抽屉（只读回显）
    fireEvent.click(topItems[1] as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-heat-drawer-panel]')).not.toBeNull(),
    )
    const drawer = document.querySelector('[data-bi-heat-drawer-panel]') as HTMLElement
    expect(within(drawer).getByText('开项核心引擎 × 严重')).toBeInTheDocument()
    expect(within(drawer).getByText('主要贡献单元')).toBeInTheDocument()
    expect(within(drawer).getByText('数据合规审计处罚')).toBeInTheDocument()
    expect(drawer.querySelector('[data-bi-heat-drawer-drilldown]')).not.toBeNull()
    expect(within(drawer).getByText('需权限')).toBeInTheDocument()
  })

  test('脱敏单元：中性「不可见」呈现，零数值文本（RL-05）', async () => {
    respondHeatmap(defaultCells())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())

    const redactedCell = document.querySelector('[data-bi-heat-redacted]')
    expect(redactedCell).not.toBeNull()
    expect(redactedCell?.textContent).toContain('不可见')
    expect(redactedCell?.textContent).not.toMatch(/\d/)
  })

  test('筛选（指标/窗口/行列维度）触发带新参数的只读重查', async () => {
    respondHeatmap(defaultCells())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())
    expect(lastQuery().get('metricKey')).toBe('risk_exposure_score')
    expect(lastQuery().get('window')).toBe('last_90_days')

    fireEvent.change(document.querySelector('[data-bi-heat-filter-metric]') as Element, {
      target: { value: 'risk_count' },
    })
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(lastQuery().get('metricKey')).toBe('risk_count')

    fireEvent.change(document.querySelector('[data-bi-heat-filter-window]') as Element, {
      target: { value: 'last_30_days' },
    })
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(lastQuery().get('window')).toBe('last_30_days')

    fireEvent.change(document.querySelector('[data-bi-heat-filter-row]') as Element, {
      target: { value: 'portfolio_group' },
    })
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(4))
    expect(lastQuery().get('rowDimension')).toBe('portfolio_group')

    fireEvent.change(document.querySelector('[data-bi-heat-filter-column]') as Element, {
      target: { value: 'risk_category' },
    })
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(5))
    expect(lastQuery().get('columnDimension')).toBe('risk_category')
  })

  test('只读铁律：筛选/点击/抽屉/刷新全程零写请求（RL-01）', async () => {
    respondHeatmap(defaultCells())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-top-item]')).not.toBeNull())

    // 改变窗口 → 重查加载完成后再交互
    fireEvent.change(document.querySelector('[data-bi-heat-filter-window]') as Element, {
      target: { value: 'last_7_days' },
    })
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-bi-heat-top-item]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-heat-drawer-panel]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-bi-heat-drawer-close]') as Element)
    fireEvent.click(document.querySelector('[data-bi-heat-refresh]') as Element)
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(3))

    const requests = envelopeMock.mock.calls.map((call) => call[1] as RequestInit | undefined)
    expect(requests.every((init) => init?.method === undefined || init.method === 'GET')).toBe(true)
  })
})

describe('RiskHeatmapWorkspace：三态闭环', () => {
  test('空态：无数据且无受限 warning → 语义空态', async () => {
    respondHeatmap([])
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-empty]')).not.toBeNull())
    expect(screen.getByText('暂无热力图数据')).toBeInTheDocument()
  })

  test('受限态：零数据 + REDACTED warning → 中性受限横幅（不猜测数值）', async () => {
    respondHeatmap([], [{ code: 'DIMENSION_REDACTED', message: '维度已脱敏' }])
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-restricted]')).not.toBeNull())
    expect(screen.getByText('无权限查看该热力数据')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('暂无热力图数据')
  })

  test('错误态：5xx 失败展示错误卡，点击重试后 refetch 成功', async () => {
    envelopeMock.mockRejectedValueOnce(new Error('BOOM'))
    respondHeatmap(defaultCells())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-error]')).not.toBeNull())
    expect(screen.getByText(/热力图数据加载失败/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-bi-heat-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())
  })
})
