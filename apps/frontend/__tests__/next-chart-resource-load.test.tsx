/**
 * v3-ui-next-chart-gallery W2 · tasks 2.2 —— 资源负荷镜头测试。
 *
 * 覆盖：
 * - Trend：30 天日历柱状数据映射（正常/超额拆分）、100% 额定容量 markLine 阈值、
 *   Tooltip 内容、只读窗口标签；超负荷日（利用率 >100%）红色堆叠断言；
 * - Trend/Team 视图切换（第二次 GET 带 view=team）与团队数字矩阵/统计徽章；
 * - 空态（无资源/无成员）与错误重试；交互期间零网络写请求（RL-01）。
 *
 * ECharts 以 jsdom 桩替换（design §8.1 / __tests__/helpers/echarts-mock.ts）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ResourceLoadResult, TrendDay, TrendResult } from '@/lib/api/resources'
import {
  createDefaultLoadWindow,
  shiftDays,
  localDateKey,
} from '@/lib/next/charts/resource-load-adapter'
import { ResourceLoadChartLens } from '@/components/next/charts/lenses/ResourceLoadChartLens'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// ECharts jsdom 桩（design §8.1）：工厂内不同步调用导入绑定（TDZ 安全）。
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

const loadMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/resources', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/resources')>()
  return {
    ...original,
    resourcesApi: { ...original.resourcesApi, load: loadMock },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function trendDays(days: TrendDay[]): TrendResult {
  return {
    from: days[0]?.date ?? '',
    to: days[days.length - 1]?.date ?? '',
    totalResources: 3,
    days,
  }
}

function makeTeamResult(overrides: Partial<ResourceLoadResult> = {}): ResourceLoadResult {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    teamAverageUtilizationPercent: 75,
    resources: [
      {
        resourceId: 11,
        resourceName: '张启明',
        role: 'member',
        dailyCapacityHours: 8,
        overallUtilizationPercent: 200,
        days: [
          { date: '2026-09-01', totalAllocatedPercent: 200, allocatedHours: 16, capacityHours: 8 },
        ],
      },
      {
        resourceId: 12,
        resourceName: '李思远',
        role: 'project_manager',
        dailyCapacityHours: 8,
        overallUtilizationPercent: 25,
        days: [
          { date: '2026-09-01', totalAllocatedPercent: 25, allocatedHours: 2, capacityHours: 8 },
        ],
      },
      {
        resourceId: 13,
        resourceName: '王静',
        role: 'team_lead',
        dailyCapacityHours: 8,
        overallUtilizationPercent: 0,
        days: [
          { date: '2026-09-01', totalAllocatedPercent: 0, allocatedHours: 0, capacityHours: 8 },
        ],
      },
    ],
    ...overrides,
  }
}

function renderLens(client: QueryClient, projectId = 42) {
  return render(
    <QueryClientProvider client={client}>
      <ResourceLoadChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

interface OptionShape {
  xAxis?: { data?: unknown[] }
  series?: Array<{
    name?: string
    type?: string
    stack?: string
    data?: number[]
    itemStyle?: { color?: string }
    markLine?: { data?: Array<{ yAxis?: number }> }
  }>
  tooltip?: { formatter?: (params: unknown) => string }
}

function lastTrendOption(): OptionShape {
  return (ensureLazyEchartsMock().lastOption ?? {}) as OptionShape
}

beforeEach(() => {
  ensureLazyEchartsMock().reset()
  loadMock.mockReset()
})

describe('资源负荷 Trend 时序趋势直方图（spec 场景）', () => {
  test('30 天日历柱状：正常/超额拆分 + 100% 容量警戒线 + Tooltip', async () => {
    const window = createDefaultLoadWindow()
    const days: TrendDay[] = Array.from({ length: 30 }, (_, index) => {
      const date = localDateKey(shiftDays(new Date(`${window.to}T00:00:00`), index - 29))
      const capacityHours = 24
      const totalHours = index === 0 ? 10 : index === 1 ? 26 : index === 29 ? 24 : 20
      return {
        date,
        capacityHours,
        totalHours,
        utilizationPercent: Math.round((totalHours / capacityHours) * 1000) / 10,
      }
    })
    loadMock.mockResolvedValue(trendDays(days))

    renderLens(createClient())

    // 首帧加载骨架
    expect(screen.getByRole('status', { name: '正在加载资源负荷趋势数据' })).toBeInTheDocument()

    const chart = await screen.findByRole('img', { name: '资源负荷时序趋势直方图' })
    expect(loadMock).toHaveBeenCalledTimes(1)
    expect(loadMock).toHaveBeenCalledWith(42, {
      from: window.from,
      to: window.to,
      view: 'trend',
    })
    // jsdom 桩回填 SVG（design §8.1）
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()

    const option = lastTrendOption()
    expect(option.xAxis?.data).toHaveLength(30)
    expect(option.xAxis?.data?.[0]).toBe(days[0]?.date)

    const [normalSeries, overloadSeries] = option.series ?? []
    expect(normalSeries?.name).toBe('正常分配工时')
    expect(normalSeries?.stack).toBe('load-hours')
    // 第 0 天 10h 全部正常；第 1 天 26h → 正常 24 + 超额 2
    expect(normalSeries?.data?.[0]).toBe(10)
    expect(overloadSeries?.data?.[0]).toBe(0)
    expect(normalSeries?.data?.[1]).toBe(24)
    expect(overloadSeries?.data?.[1]).toBe(2)
    expect(normalSeries?.itemStyle?.color).toBe('#38bdf8')
    expect(overloadSeries?.itemStyle?.color).toBe('#ef4444')
    // 100% 额定容量警戒基准线 markLine（yAxis = 日容量 24）
    expect(overloadSeries?.markLine?.data).toEqual([{ yAxis: 24 }])

    // Tooltip 内容：日期 + 超负荷红色堆叠说明（调 formatter 直接断言）
    const formatter = option.tooltip?.formatter
    expect(formatter).toBeTypeOf('function')
    const html = formatter?.([{ dataIndex: 1 }]) ?? ''
    expect(html).toContain(days[1]?.date ?? '')
    expect(html).toContain('分配工时：<b style="color:#f1f5f9">26</b> h')
    expect(html).toContain('额定容量：24 h')
    expect(html).toContain('⚠ 超负荷 2 h')
    // 不超负荷日无超负荷行
    const normalHtml = formatter?.([{ dataIndex: 0 }]) ?? ''
    expect(normalHtml).not.toContain('超负荷')
  })

  test('无活跃资源时渲染语义空态，零写请求', async () => {
    loadMock.mockResolvedValue({
      from: '2026-01-01',
      to: '2026-01-30',
      totalResources: 0,
      days: [],
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderLens(createClient())

    await screen.findByRole('status', { name: '资源负荷趋势数据为空' })
    expect(screen.getByText('当前项目暂无资源负荷数据')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('接口 500 错误 → 错误卡 + 重新加载恢复', async () => {
    loadMock
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(
        trendDays([
          {
            date: '2026-09-01',
            capacityHours: 8,
            totalHours: 4,
            utilizationPercent: 50,
          },
        ]),
      )
    renderLens(createClient())

    const alert = await screen.findByRole('alert', { name: '资源负荷趋势加载失败' })
    expect(alert).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '资源负荷时序趋势直方图' })
    expect(loadMock).toHaveBeenCalledTimes(2)
  })
})

describe('资源负荷 Trend/Team 双视图切换（spec 场景）', () => {
  test('切 Team：带 view=team 的 GET + 容量构成条形 + 精确矩阵与徽章', async () => {
    const window = createDefaultLoadWindow()
    const days: TrendDay[] = [0, 1].map((_, index) => {
      const date = localDateKey(shiftDays(new Date(`${window.to}T00:00:00`), index - 1))
      return { date, capacityHours: 24, totalHours: 12, utilizationPercent: 50 }
    })
    loadMock.mockResolvedValueOnce(trendDays(days)).mockResolvedValueOnce(makeTeamResult())
    renderLens(createClient())

    await screen.findByRole('img', { name: '资源负荷时序趋势直方图' })

    fireEvent.click(screen.getByRole('tab', { name: '团队成员 (Team)' }))
    const teamBar = await screen.findByRole('img', { name: '团队成员负荷条形图' })
    expect(teamBar).toBeInTheDocument()
    expect(loadMock).toHaveBeenLastCalledWith(42, {
      from: window.from,
      to: window.to,
      view: 'team',
    })
    // 容量构成堆叠：张启明 16h 分配 → 正常 8 + 超额 8；李思远 2h → 正常 2 + 未利用 6
    const option = lastTrendOption()
    const series = option.series ?? []
    expect(series.map((item) => item.name)).toEqual(['正常分配工时', '超负荷工时', '未利用容量'])
    expect(series[0]?.data).toEqual([8, 2, 0])
    expect(series[1]?.data).toEqual([8, 0, 0])
    expect(series[2]?.data).toEqual([0, 6, 8])

    // 精确数字矩阵（spec：总容量/总分配/平均利用率/状态）
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByText('张启明')).toBeInTheDocument()
    expect(screen.getByText('团队负责人')).toBeInTheDocument()
    const rows = document.querySelectorAll('[data-member-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('200%')
    expect(rows[0]?.textContent).toContain('超负荷')
    expect(rows[1]?.textContent).toContain('25%')
    expect(rows[2]?.textContent).toContain('0%')
    expect(rows[2]?.textContent).toContain('未分配')
    // 统计徽章（团队平均利用率/超负荷成员数）
    expect(screen.getByText(/超负荷成员/)).toBeInTheDocument()
    expect(screen.getByText(/团队平均利用率/)).toBeInTheDocument()

    // 切回 Trend（缓存命中不再发请求）
    fireEvent.click(screen.getByRole('tab', { name: '时序趋势 (Trend)' }))
    await screen.findByRole('img', { name: '资源负荷时序趋势直方图' })
    expect(loadMock).toHaveBeenCalledTimes(2)
  })

  test('Team 无成员数据 → 语义空态', async () => {
    loadMock
      .mockResolvedValueOnce({ from: '2026-09-01', to: '2026-09-30', totalResources: 0, days: [] })
      .mockResolvedValueOnce({
        from: '2026-09-01',
        to: '2026-09-30',
        resources: [],
        teamAverageUtilizationPercent: 0,
      })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderLens(createClient())

    // Trend 空态
    await screen.findByRole('status', { name: '资源负荷趋势数据为空' })

    // 切到 Team → 空态（二次 GET，view=team）
    fireEvent.click(screen.getByRole('tab', { name: '团队成员 (Team)' }))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: '团队成员负荷数据为空' })).toBeInTheDocument(),
    )
    expect(screen.getByText('当前项目暂无团队成员负荷数据')).toBeInTheDocument()
    expect(loadMock).toHaveBeenLastCalledWith(42, expect.objectContaining({ view: 'team' }))
    // 全程零网络（数据层为 GET 桩；此处断言无任何意外请求）
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
