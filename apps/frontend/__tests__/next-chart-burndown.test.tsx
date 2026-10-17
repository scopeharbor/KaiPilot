/**
 * v3-chart-gallery-tier2-timeseries-metrics W4 · task 4.2 —— 燃尽/燃起图镜头测试。
 *
 * 覆盖：
 * - Adapter 纯函数：task/hour 双口径序列抽取正确性、范围蔓延（Scope Creep）计算、
 *   4 条序列（理想/实际燃尽/累计燃起/总范围基准）完整性；
 * - 组件渲染：口径与粒度切换触发带对应参数的只读 GET、概览徽标、空态/错误重试；
 * - RL-01 零写网络断言；精确档 animation=false；中性文案铁律。
 *
 * ECharts 以 jsdom 桩替换（__tests__/helpers/echarts-mock.ts）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BurndownGranularity, BurndownMetric, BurndownResult } from '@/lib/api/project-metrics'
import {
  buildBurndownOption,
  buildBurndownOverview,
  buildBurndownSeriesData,
  burndownUnitLabel,
} from '@/lib/next/charts/burndown-adapter'
import { BurndownChartLens } from '@/components/next/charts/lenses/BurndownChartLens'
import { useNextTrackStore } from '@/stores/next-track-store'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'

// ---------------------------------------------------------------------------
// Module mocks
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

const burndownMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: { ...original.projectMetricsApi, burndown: burndownMock },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const RAW_POINTS = [
  {
    date: '2026-09-01',
    fraction: 1,
    remainingTasks: 10,
    remainingHours: 80,
    completedTasks: 0,
    completedHours: 0,
    totalScopeTasks: 10,
    totalScopeHours: 80,
  },
  {
    date: '2026-09-02',
    fraction: 0.5,
    remainingTasks: 6,
    remainingHours: 48,
    completedTasks: 4,
    completedHours: 32,
    totalScopeTasks: 10,
    totalScopeHours: 80,
  },
  {
    date: '2026-09-03',
    fraction: 0,
    remainingTasks: 3,
    remainingHours: 24,
    completedTasks: 9,
    completedHours: 72,
    totalScopeTasks: 12,
    totalScopeHours: 96,
  },
] as const

function makeBurndownResult(
  metric: BurndownMetric,
  granularity: BurndownGranularity = 'day',
): BurndownResult {
  const initialScopeTasks = 10
  const initialScopeHours = 80
  return {
    projectId: 42,
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    granularity,
    metric,
    initialScopeTasks,
    initialScopeHours,
    points: RAW_POINTS.map((p) => ({
      date: p.date,
      idealRemaining: Number(
        (metric === 'hour'
          ? initialScopeHours * p.fraction
          : initialScopeTasks * p.fraction
        ).toFixed(2),
      ),
      remainingTasks: p.remainingTasks,
      remainingHours: p.remainingHours,
      completedTasks: p.completedTasks,
      completedHours: p.completedHours,
      totalScopeTasks: p.totalScopeTasks,
      totalScopeHours: p.totalScopeHours,
    })),
  }
}

function renderLens(client: QueryClient, projectId = 42) {
  return render(
    <QueryClientProvider client={client}>
      <BurndownChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  ensureLazyEchartsMock().reset()
  burndownMock.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('burndown-adapter 纯函数（spec：双口径序列 / 范围蔓延）', () => {
  test('buildBurndownSeriesData：task 口径 4 条序列', () => {
    const data = buildBurndownSeriesData(makeBurndownResult('task'))
    expect(data.categories).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(data.ideal).toEqual([10, 5, 0])
    expect(data.remaining).toEqual([10, 6, 3])
    expect(data.completed).toEqual([0, 4, 9])
    expect(data.totalScope).toEqual([10, 10, 12])
  })

  test('buildBurndownSeriesData：hour 口径 4 条序列', () => {
    const data = buildBurndownSeriesData(makeBurndownResult('hour'))
    expect(data.ideal).toEqual([80, 40, 0])
    expect(data.remaining).toEqual([80, 48, 24])
    expect(data.completed).toEqual([0, 32, 72])
    expect(data.totalScope).toEqual([80, 80, 96])
  })

  test('buildBurndownOverview：范围净变化（Scope Creep）计算', () => {
    const taskOverview = buildBurndownOverview(makeBurndownResult('task'))
    expect(taskOverview).toMatchObject({
      remaining: 3,
      completed: 9,
      totalScope: 12,
      initialScope: 10,
      scopeCreep: 2,
    })
    const hourOverview = buildBurndownOverview(makeBurndownResult('hour'))
    expect(hourOverview).toMatchObject({
      remaining: 24,
      completed: 72,
      totalScope: 96,
      initialScope: 80,
      scopeCreep: 16,
    })
  })

  test('burndownUnitLabel：口径单位标签', () => {
    expect(burndownUnitLabel('task')).toBe('任务 (个)')
    expect(burndownUnitLabel('hour')).toBe('小时 (h)')
  })

  test('buildBurndownOption：4 条序列命名与数据映射', () => {
    const data = buildBurndownSeriesData(makeBurndownResult('task'))
    const option = buildBurndownOption(data, 'task', true) as unknown as {
      animation?: boolean
      series?: Array<{ name?: string }>
    }
    expect(option.animation).toBe(true)
    const names = (option.series ?? []).map((s) => s.name)
    expect(names).toEqual(['理想燃尽线', '实际燃尽线', '累计完成燃起线', '总范围基准线'])
  })
})

describe('BurndownChartLens 组件（spec 场景）', () => {
  test('默认 task/day：概览徽标 + 图表渲染 + 零写网络', async () => {
    burndownMock.mockImplementation((_projectId: number, params: Record<string, unknown>) =>
      Promise.resolve(
        makeBurndownResult(
          (params.metric as BurndownMetric) ?? 'task',
          (params.granularity as BurndownGranularity) ?? 'day',
        ),
      ),
    )
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderLens(createClient())

    const chart = await screen.findByRole('img', { name: '燃尽与燃起时序图' })
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()
    expect(burndownMock).toHaveBeenCalledWith(42, { metric: 'task', granularity: 'day' })

    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain('3 任务 (个)')
    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain('9 任务 (个)')
    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain(
      '12 任务 (个)',
    )
    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain(
      '+2 任务 (个)',
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('切换至 hour 口径：带 metric=hour 的只读 GET + 概览换算为工时', async () => {
    burndownMock.mockImplementation((_projectId: number, params: Record<string, unknown>) =>
      Promise.resolve(
        makeBurndownResult(
          (params.metric as BurndownMetric) ?? 'task',
          (params.granularity as BurndownGranularity) ?? 'day',
        ),
      ),
    )
    renderLens(createClient())
    await screen.findByRole('img', { name: '燃尽与燃起时序图' })

    fireEvent.click(screen.getByRole('tab', { name: '按工时 (hour)' }))
    await screen.findByRole('img', { name: '燃尽与燃起时序图' })
    expect(burndownMock).toHaveBeenLastCalledWith(42, { metric: 'hour', granularity: 'day' })
    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain('24 小时 (h)')
    expect(document.querySelector('[data-burndown-overview]')?.textContent).toContain(
      '+16 小时 (h)',
    )
  })

  test('切换粒度至 week：带 granularity=week 的只读 GET', async () => {
    burndownMock.mockImplementation((_projectId: number, params: Record<string, unknown>) =>
      Promise.resolve(
        makeBurndownResult(
          (params.metric as BurndownMetric) ?? 'task',
          (params.granularity as BurndownGranularity) ?? 'day',
        ),
      ),
    )
    renderLens(createClient())
    await screen.findByRole('img', { name: '燃尽与燃起时序图' })

    fireEvent.click(screen.getByRole('tab', { name: '按周 (week)' }))
    await screen.findByRole('img', { name: '燃尽与燃起时序图' })
    expect(burndownMock).toHaveBeenLastCalledWith(42, { metric: 'task', granularity: 'week' })
  })

  test('空数据：语义空态', async () => {
    burndownMock.mockResolvedValue({ ...makeBurndownResult('task'), points: [] })
    renderLens(createClient())
    await screen.findByRole('status', { name: '燃尽/燃起图数据为空' })
    expect(screen.getByText('当前项目暂无燃尽/燃起数据')).toBeInTheDocument()
  })

  test('接口失败：错误卡 + 重新加载恢复', async () => {
    burndownMock
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(makeBurndownResult('task'))
    renderLens(createClient())

    await screen.findByRole('alert', { name: '燃尽/燃起图加载失败' })
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '燃尽与燃起时序图' })
  })

  test('精确档（precise）：ECharts animation=false 即时定格', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    burndownMock.mockResolvedValue(makeBurndownResult('task'))
    renderLens(createClient())

    await screen.findByRole('img', { name: '燃尽与燃起时序图' })
    expect((ensureLazyEchartsMock().lastOption as { animation: boolean }).animation).toBe(false)
  })
})
