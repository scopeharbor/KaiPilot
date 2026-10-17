/**
 * v3-chart-gallery-tier2-timeseries-metrics W4 · task 4.3 —— SPC 控制图镜头测试。
 *
 * 覆盖：
 * - Adapter 纯函数：Nelson 规则码 → 中性统计学术语映射、三线控制带 markLine 装配、
 *   失控点符号/配色差异化、样本量 N < 5 优雅降级（控制限为 null，markLine 不装配）；
 * - 组件渲染：指标/采样上限切换触发对应参数的只读 GET、小样本中性说明卡、
 *   空态/错误重试；
 * - RL-01 零写网络断言；精确档 animation=false；
 * - 中性文案铁律：DOM 中严禁出现「告警/预警/严重警告/危险」字样（正则强制断言）。
 *
 * ECharts 以 jsdom 桩替换（__tests__/helpers/echarts-mock.ts）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpcResult } from '@/lib/api/project-metrics'
import {
  buildControlChartOption,
  buildControlChartPoints,
  controlChartMetricLabel,
  isSampleSizeTooSmall,
  ruleNeutralLabel,
  SAMPLE_SIZE_TOO_SMALL_MESSAGE,
} from '@/lib/next/charts/control-chart-adapter'
import { ControlChartLens } from '@/components/next/charts/lenses/ControlChartLens'
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

const controlChartMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: { ...original.projectMetricsApi, controlChart: controlChartMock },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SpcResult> = {}): SpcResult {
  return {
    summary: {
      metric: 'cycle_time',
      sampleCount: 6,
      mean: 6,
      sigma: 1,
      ucl: 9,
      lcl: 3,
      uwl: 8,
      lwl: 4,
    },
    samples: [
      {
        taskId: 1,
        taskName: '任务A',
        completedAt: '2026-09-01',
        value: 5,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 2,
        taskName: '任务B',
        completedAt: '2026-09-02',
        value: 6,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 3,
        taskName: '任务C',
        completedAt: '2026-09-03',
        value: 5,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 4,
        taskName: '任务D',
        completedAt: '2026-09-04',
        value: 7,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 5,
        taskName: '任务E',
        completedAt: '2026-09-05',
        value: 20,
        isOutlier: true,
        violatedRules: ['rule1_beyond_3sigma'],
      },
      {
        taskId: 6,
        taskName: '任务F',
        completedAt: '2026-09-06',
        value: 6,
        isOutlier: false,
        violatedRules: [],
      },
    ],
    warning: null,
    ...overrides,
  }
}

function makeSmallSampleResult(): SpcResult {
  return {
    summary: {
      metric: 'cycle_time',
      sampleCount: 3,
      mean: null,
      sigma: null,
      ucl: null,
      lcl: null,
      uwl: null,
      lwl: null,
    },
    samples: [
      {
        taskId: 1,
        taskName: '任务A',
        completedAt: '2026-09-01',
        value: 5,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 2,
        taskName: '任务B',
        completedAt: '2026-09-02',
        value: 6,
        isOutlier: false,
        violatedRules: [],
      },
      {
        taskId: 3,
        taskName: '任务C',
        completedAt: '2026-09-03',
        value: 5,
        isOutlier: false,
        violatedRules: [],
      },
    ],
    warning: 'SAMPLE_SIZE_TOO_SMALL',
  }
}

function renderLens(client: QueryClient, projectId = 42) {
  return render(
    <QueryClientProvider client={client}>
      <ControlChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  ensureLazyEchartsMock().reset()
  controlChartMock.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('control-chart-adapter 纯函数（spec：Nelson 规则中性映射 / 三线控制带 / 小样本降级）', () => {
  test('ruleNeutralLabel：Nelson 规则码 → 中性统计学术语（零告警/预警字样）', () => {
    expect(ruleNeutralLabel('rule1_beyond_3sigma')).toBe('超出控制限')
    expect(ruleNeutralLabel('rule2_nine_same_side')).toBe('连续多点同侧偏离中心线')
    expect(ruleNeutralLabel('rule3_six_monotonic_trend')).toBe('连续多点单调变化趋势')
    expect(ruleNeutralLabel('unknown_rule')).toBe('统计异常值')
    for (const label of [
      ruleNeutralLabel('rule1_beyond_3sigma'),
      ruleNeutralLabel('rule2_nine_same_side'),
      ruleNeutralLabel('rule3_six_monotonic_trend'),
    ]) {
      expect(label).not.toMatch(/告警|预警|严重警告|危险/)
    }
  })

  test('buildControlChartPoints：附中性规则文案', () => {
    const points = buildControlChartPoints(makeResult())
    expect(points[4]?.violatedRuleLabels).toEqual(['超出控制限'])
    expect(points[0]?.violatedRuleLabels).toEqual([])
  })

  test('isSampleSizeTooSmall / controlChartMetricLabel', () => {
    expect(isSampleSizeTooSmall(makeResult())).toBe(false)
    expect(isSampleSizeTooSmall(makeSmallSampleResult())).toBe(true)
    expect(controlChartMetricLabel('cycle_time')).toBe('周期时间 (天)')
    expect(controlChartMetricLabel('lead_time')).toBe('交付提前期 (天)')
  })

  test('buildControlChartOption：三线控制带 markLine（CL/UCL/LCL/UWL/LWL）+ 失控点差异化标记', () => {
    const option = buildControlChartOption(makeResult(), true)
    expect(option.animation).toBe(true)
    const series = (option.series ?? []) as Array<{
      data?: Array<{ symbol?: string; symbolSize?: number }>
      markLine?: { data?: Array<{ name?: string; yAxis?: number }> }
    }>
    const markLineData = series[0]?.markLine?.data ?? []
    expect(markLineData.map((entry) => entry.name)).toEqual([
      '中心线 CL',
      '控制上限 UCL',
      '控制下限 LCL',
      '警戒上限 UWL',
      '警戒下限 LWL',
    ])
    expect(markLineData.map((entry) => entry.yAxis)).toEqual([6, 9, 3, 8, 4])

    const points = series[0]?.data ?? []
    expect(points[4]?.symbol).toBe('diamond')
    expect(points[4]?.symbolSize).toBe(10)
    expect(points[0]?.symbol).toBe('circle')
    expect(points[0]?.symbolSize).toBe(6)
  })

  test('buildControlChartOption：N < 5 优雅降级，不装配 markLine', () => {
    const option = buildControlChartOption(makeSmallSampleResult(), true)
    const series = (option.series ?? []) as Array<{ markLine?: unknown }>
    expect(series[0]?.markLine).toBeUndefined()
  })

  test('Tooltip formatter：中性统计学术语，零告警/预警字样', () => {
    const option = buildControlChartOption(makeResult(), true) as {
      tooltip?: { formatter?: (params: unknown) => string }
    }
    const html = option.tooltip?.formatter?.([{ dataIndex: 4 }]) ?? ''
    expect(html).toContain('任务E')
    expect(html).toContain('超出控制限')
    expect(html).not.toMatch(/告警|预警|严重警告|危险/)
  })
})

describe('ControlChartLens 组件（spec 场景）', () => {
  test('样本充足（N>=5）：三线控制带渲染 + 摘要徽标 + 零写网络', async () => {
    controlChartMock.mockResolvedValue(makeResult())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderLens(createClient())

    const chart = await screen.findByRole('img', { name: 'SPC过程控制图' })
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()
    expect(controlChartMock).toHaveBeenCalledWith(42, { metric: 'cycle_time', limit: 100 })
    expect(document.querySelector('[data-control-chart-summary]')?.textContent).toContain('6')
    expect(document.querySelector('[data-control-chart-small-sample-hint]')).toBeNull()

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('切换指标为 lead_time：带 metric=lead_time 的只读 GET', async () => {
    controlChartMock.mockResolvedValue(makeResult())
    renderLens(createClient())
    await screen.findByRole('img', { name: 'SPC过程控制图' })

    fireEvent.click(screen.getByRole('tab', { name: '交付提前期 (lead time)' }))
    await screen.findByRole('img', { name: 'SPC过程控制图' })
    expect(controlChartMock).toHaveBeenLastCalledWith(42, { metric: 'lead_time', limit: 100 })
  })

  test('切换采样上限为 200：带 limit=200 的只读 GET', async () => {
    controlChartMock.mockResolvedValue(makeResult())
    renderLens(createClient())
    await screen.findByRole('img', { name: 'SPC过程控制图' })

    fireEvent.change(screen.getByRole('combobox', { name: '采样上限' }), {
      target: { value: '200' },
    })
    await screen.findByRole('img', { name: 'SPC过程控制图' })
    expect(controlChartMock).toHaveBeenLastCalledWith(42, { metric: 'cycle_time', limit: 200 })
  })

  test('样本量 N < 5：中性说明卡 + 散点趋势仍渲染，零报错', async () => {
    controlChartMock.mockResolvedValue(makeSmallSampleResult())
    renderLens(createClient())

    const chart = await screen.findByRole('img', { name: 'SPC过程控制图' })
    expect(chart).toBeInTheDocument()
    expect(screen.getByText(SAMPLE_SIZE_TOO_SMALL_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('零完工样本：语义空态', async () => {
    controlChartMock.mockResolvedValue({ ...makeResult(), samples: [] })
    renderLens(createClient())
    await screen.findByRole('status', { name: 'SPC控制图数据为空' })
    expect(screen.getByText('当前项目暂无可用于统计过程控制的完工样本')).toBeInTheDocument()
  })

  test('接口失败：错误卡 + 重新加载恢复', async () => {
    controlChartMock
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(makeResult())
    renderLens(createClient())

    await screen.findByRole('alert', { name: 'SPC控制图加载失败' })
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: 'SPC过程控制图' })
  })

  test('精确档（precise）：ECharts animation=false 即时定格', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    controlChartMock.mockResolvedValue(makeResult())
    renderLens(createClient())

    await screen.findByRole('img', { name: 'SPC过程控制图' })
    expect((ensureLazyEchartsMock().lastOption as { animation: boolean }).animation).toBe(false)
  })
})
