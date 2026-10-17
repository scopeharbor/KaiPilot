/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.10 —— BI 趋势分析工作台组件测试。
 *
 * 覆盖（tasks 3.10 / spec「组织 BI 三镜头」场景）：
 * - 指标切换与时段/粒度筛选触发带新参数的只读重查；
 * - ECharts（echarts-core 桩）线图 option：主序列/移动平均/外推/异常点叠加序列；
 * - 异常列表徽标（方向/严重度文案）与解释抽屉（洞察 severity 徽标 + advisory 免责）；
 * - 外推开关注查（includeForecast）；全程零写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { TrendsWorkspace } from '@/components/next/org-bi/TrendsWorkspace'
import { useAuthStore } from '@/stores/auth-store'
import type { BiTrendSeries } from '@aiproj/types'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'

// ---------------------------------------------------------------------------
// 模块 mock
// ---------------------------------------------------------------------------
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      bundle.lastDom = dom
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

function setAuth(permissions: string[]) {
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
    currentOrganizationId: 1,
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
function makeSeries(overrides: Partial<BiTrendSeries>): BiTrendSeries {
  return {
    metricKey: 'project_progress',
    metricVersion: 'bi-trend-v1',
    grain: 'week',
    window: 'last_12_weeks',
    points: [
      {
        bucketStart: '2026-07-06T00:00:00.000Z',
        bucketEnd: '2026-07-12T00:00:00.000Z',
        value: 12,
        missing: false,
        sampleCount: 5,
      },
      {
        bucketStart: '2026-07-13T00:00:00.000Z',
        bucketEnd: '2026-07-19T00:00:00.000Z',
        value: 15,
        missing: false,
        sampleCount: 5,
      },
      {
        bucketStart: '2026-07-20T00:00:00.000Z',
        bucketEnd: '2026-07-26T00:00:00.000Z',
        value: null,
        missing: true,
        sampleCount: 0,
      },
      {
        bucketStart: '2026-07-27T00:00:00.000Z',
        bucketEnd: '2026-08-02T00:00:00.000Z',
        value: 18,
        missing: false,
        sampleCount: 5,
      },
      {
        bucketStart: '2026-08-03T00:00:00.000Z',
        bucketEnd: '2026-08-09T00:00:00.000Z',
        value: 24,
        missing: false,
        sampleCount: 5,
      },
      {
        bucketStart: '2026-08-10T00:00:00.000Z',
        bucketEnd: '2026-08-16T00:00:00.000Z',
        value: 31,
        missing: false,
        sampleCount: 5,
      },
    ],
    movingAverage: [null, 13.5, null, null, null, null],
    direction: 'up',
    anomalies: [
      {
        bucketStart: '2026-08-10T00:00:00.000Z',
        value: 31,
        expected: 21,
        deviation: 10,
        zScore: 4.2,
        direction: 'above',
        threshold: 2,
        evidenceRefs: [{ kind: 'organization_dashboard', label: '组织概览快照' }],
      },
    ],
    forecast: {
      method: 'linear_extrapolation',
      suppressed: false,
      points: [
        {
          bucketStart: '2026-08-17T00:00:00.000Z',
          bucketEnd: '2026-08-23T00:00:00.000Z',
          value: 36,
        },
        {
          bucketStart: '2026-08-24T00:00:00.000Z',
          bucketEnd: '2026-08-30T00:00:00.000Z',
          value: 41,
        },
      ],
    },
    freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
    warnings: [],
    insights: [
      {
        kind: 'anomaly_summary',
        severity: 'critical',
        title: '项目进度突增异常',
        description: '最近一周进度值显著高于期望水平，请结合交付记录核实口径。',
        advisoryOnly: true,
        warnings: [],
      },
    ],
    sampleCount: 30,
    evidenceRefs: [],
    ...overrides,
  }
}

function okrSeries(): BiTrendSeries {
  return makeSeries({
    metricKey: 'okr_progress',
    direction: 'flat',
    anomalies: [],
    insights: [
      {
        kind: 'direction_summary',
        severity: 'attention',
        title: 'OKR 进展持平',
        description: '近 12 周 OKR 平均进度基本持平。',
        advisoryOnly: true,
        warnings: [],
      },
    ],
    points: makeSeries({}).points.map((point, index) => ({
      ...point,
      value: index < 3 ? null : 60,
    })),
    movingAverage: [],
    sampleCount: 12,
  })
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TrendsWorkspace organizationId={1} />
    </QueryClientProvider>,
  )
}

function lastQuery(): URLSearchParams {
  const path = envelopeMock.mock.calls[envelopeMock.mock.calls.length - 1]?.[0] ?? ''
  return new URLSearchParams(path.split('?')[1] ?? '')
}

beforeEach(() => {
  envelopeMock.mockReset()
  ensureLazyEchartsMock().reset()
  setAuth(['org:view', 'portfolio:view'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TrendsWorkspace：图表与筛选重查（spec 场景「组织指标趋势线图与异常标注」）', () => {
  test('默认请求 6 指标；线图 option 含主序列/移动平均/外推续段与异常叠加层', async () => {
    envelopeMock.mockResolvedValue({
      data: [makeSeries({}), okrSeries()],
      meta: {
        total: 2,
        page: 1,
        perPage: 20,
        totalPages: 1,
        calculatedAt: '2026-09-10T08:00:00.000Z',
      },
      warnings: [],
    })
    renderWorkspace()

    expect(document.querySelector('[data-bi-trend-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelectorAll('[data-bi-trend-card]')).toHaveLength(2))
    expect(screen.getByText('BI 趋势分析')).toBeInTheDocument()
    expect(screen.getAllByText('项目进度').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OKR 进展').length).toBeGreaterThan(0)

    // 默认 6 指标全选、12 周、周粒
    expect(lastQuery().get('metricKeys')?.split(',')).toHaveLength(6)
    expect(lastQuery().get('window')).toBe('last_12_weeks')
    expect(lastQuery().get('grain')).toBe('week')

    // ECharts 桩：两张卡各一个实例；项目进度卡 option 序列齐全
    const bundle = ensureLazyEchartsMock()
    expect(bundle.instances.length).toBeGreaterThanOrEqual(2)
    const progressOption = bundle.instances[0]?.options[0] as
      { series?: Array<{ name: string; data: unknown }> } | undefined
    const names = (progressOption?.series ?? []).map((entry) => entry.name)
    expect(names).toContain('实际')
    expect(names).toContain('移动平均')
    expect(names).not.toContain('外推') // 默认关闭
    expect(names).toContain('异常点')
    const main = (progressOption?.series ?? []).find((entry) => entry.name === '实际')
    // 轴含外推续段桶（默认不显示外推线，但轴对齐保留主序列尾随 null）
    expect(main?.data as (number | null)[]).toEqual([12, 15, null, 18, 24, 31, null, null])
  })

  test('指标切换 / 窗口 / 粒度 / 外推开关：以新参数只读重查', async () => {
    envelopeMock.mockResolvedValue({
      data: [makeSeries({}), okrSeries()],
      meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
      warnings: [],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelectorAll('[data-bi-trend-card]')).toHaveLength(2))
    const initialCalls = envelopeMock.mock.calls.length

    // 关闭 okr_progress 指标
    fireEvent.click(
      document.querySelector('[data-bi-trend-filter-metric="okr_progress"]') as Element,
    )
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThan(initialCalls))
    expect(lastQuery().get('metricKeys')?.split(',')).toHaveLength(5)
    expect(lastQuery().get('metricKeys')).not.toContain('okr_progress')

    // 时间窗口 → last_6_months；粒度 → month
    fireEvent.change(document.querySelector('[data-bi-trend-filter-window]') as Element, {
      target: { value: 'last_6_months' },
    })
    fireEvent.change(document.querySelector('[data-bi-trend-filter-grain]') as Element, {
      target: { value: 'month' },
    })
    await waitFor(() => expect(lastQuery().get('window')).toBe('last_6_months'))
    expect(lastQuery().get('grain')).toBe('month')

    // 开启外推 → includeForecast=true
    fireEvent.click(document.querySelector('[data-bi-trend-filter-forecast]') as Element)
    await waitFor(() => expect(lastQuery().get('includeForecast')).toBe('true'))
    // 异常开关默认开
    expect(lastQuery().get('includeAnomalies')).toBe('true')
  })

  test('异常列表徽标（方向/严重度）与解释抽屉（洞察 + advisory 免责）', async () => {
    envelopeMock.mockResolvedValue({
      data: [makeSeries({}), okrSeries()],
      meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
      warnings: [],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-trend-card]')).not.toBeNull())

    // 异常列表：1 条严重 · 高于期望（z=4.2 分级）
    const anomalyList = document.querySelector('[data-bi-trend-anomaly-list]')
    expect(anomalyList).not.toBeNull()
    const items = document.querySelectorAll('[data-bi-trend-anomaly-item]')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('严重')
    expect(document.querySelector('[data-bi-trend-anomaly-direction]')?.textContent).toContain('↑')

    // 点击异常行 → 解释抽屉
    fireEvent.click(items[0] as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-trend-drawer-panel]')).not.toBeNull(),
    )
    const drawer = document.querySelector('[data-bi-trend-drawer-panel]') as HTMLElement
    expect(within(drawer).getByText('项目进度 · 解释')).toBeInTheDocument()
    expect(
      drawer.querySelector('[data-bi-trend-insight-severity="critical"]')?.textContent,
    ).toContain('严重')
    expect(within(drawer).getByText('项目进度突增异常')).toBeInTheDocument()
    // RL-01 免责声明
    expect(within(drawer).getByText('仅供建议，不自动执行——采纳需人工确认')).toBeInTheDocument()
    expect(within(drawer).getByText(/实际 31\.0% vs 期望 21\.0%/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-bi-trend-drawer-close]') as Element)
    expect(document.querySelector('[data-bi-trend-drawer-panel]')).toBeNull()
  })

  test('只读铁律：筛选/切换/抽屉/刷新全程零写请求（RL-01）', async () => {
    envelopeMock.mockResolvedValue({
      data: [makeSeries({})],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      warnings: [],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-trend-card]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-bi-trend-filter-window]') as Element, {
      target: { value: 'last_90_days' },
    })
    // 新窗口重查完成后（内容重新挂载）再交互
    await waitFor(() =>
      expect(document.querySelector('[data-bi-trend-anomaly-item]')).not.toBeNull(),
    )
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    fireEvent.click(document.querySelector('[data-bi-trend-anomaly-item]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-trend-drawer-panel]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-bi-trend-drawer-close]') as Element)
    fireEvent.click(document.querySelector('[data-bi-trend-refresh]') as Element)
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThanOrEqual(3))

    const requests = envelopeMock.mock.calls.map((call) => call[1] as RequestInit | undefined)
    expect(requests.every((init) => init?.method === undefined || init.method === 'GET')).toBe(true)
  })
})

describe('TrendsWorkspace：三态闭环', () => {
  test('空态与受限态区分', async () => {
    envelopeMock.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      warnings: [],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-trend-empty]')).not.toBeNull())
    expect(screen.getByText('暂无趋势数据')).toBeInTheDocument()
  })

  test('受限态：REDACTED warning → 中性受限横幅', async () => {
    envelopeMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      warnings: [{ code: 'DIMENSION_REDACTED', message: '维度已脱敏' }],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-trend-restricted]')).not.toBeNull())
    expect(screen.getByText('无权限查看该趋势数据')).toBeInTheDocument()
  })

  test('错误态：失败后点击重试恢复', async () => {
    envelopeMock.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValue({
      data: [makeSeries({})],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      warnings: [],
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-trend-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-bi-trend-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-trend-card]')).not.toBeNull())
  })
})
