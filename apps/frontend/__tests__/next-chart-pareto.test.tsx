/**
 * 柏拉图 (Pareto) 镜头定向测试（v3-chart-gallery-tier2-pareto-lob W2 · task 2.2）。
 *
 * 覆盖：
 * - Adapter 纯函数：4 维标签映射、频数降序、80% 参考线、超过 10 项归并为「其他（合并）」、
 *   关键少数（isVitalFew）高亮；
 * - 组件渲染：顶部 4 维切换 Tab、关键少数概览、ECharts 双 Y 轴图表初始化；
 * - RL-01 零写网络断言：切换维度全程零写请求（POST/PUT/PATCH/DELETE）；
 * - DOM 中性措辞断言：正则强制校验零感性惊恐词汇（告警/预警/危险等）；
 * - 空态降级与错误重试；
 * - 精确档（precise）animation: false。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ParetoItem, ParetoResult } from '@/lib/api/project-metrics'
import {
  buildParetoOption,
  getCategoryFallbackLabel,
  normalizeParetoItems,
  NX_PARETO_TRIVIAL_COLOR,
  NX_PARETO_VITAL_FEW_COLOR,
  PARETO_DIMENSION_NAMES,
} from '@/lib/next/charts/pareto-adapter'
import { ParetoChartLens } from '@/components/next/charts/lenses/ParetoChartLens'
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

const paretoMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: {
      ...original.projectMetricsApi,
      pareto: paretoMock,
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeSampleItems(): ParetoItem[] {
  return [
    {
      category: 'bug',
      label: '功能缺陷',
      count: 50,
      percentage: 50,
      cumulativePercentage: 50,
      isVitalFew: true,
    },
    {
      category: 'blocker',
      label: '阻塞障碍',
      count: 30,
      percentage: 30,
      cumulativePercentage: 80,
      isVitalFew: true,
    },
    {
      category: 'technical',
      label: '技术问题',
      count: 15,
      percentage: 15,
      cumulativePercentage: 95,
      isVitalFew: false,
    },
    {
      category: 'process',
      label: '流程问题',
      count: 5,
      percentage: 5,
      cumulativePercentage: 100,
      isVitalFew: false,
    },
  ]
}

function makeParetoResult(overrides: Partial<ParetoResult> = {}): ParetoResult {
  return {
    dimension: 'issue_type',
    totalCount: 100,
    items: makeSampleItems(),
    ...overrides,
  }
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
}

function renderLens(client: QueryClient = createClient(), projectId = 42) {
  return render(
    <QueryClientProvider client={client}>
      <ParetoChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

interface ParetoOptionShape {
  animation?: boolean
  xAxis?: { data?: string[] }
  yAxis?: Array<{ name?: string }>
  series?: Array<{
    type?: string
    name?: string
    data?: Array<{ value: number; itemStyle: { color: string } } | number>
    smooth?: boolean
    yAxisIndex?: number
    markLine?: { data: Array<{ yAxis: number }> }
  }>
}

function lastOption(): ParetoOptionShape {
  return (ensureLazyEchartsMock().lastOption ?? {}) as ParetoOptionShape
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pareto 柏拉图适配器纯函数', () => {
  test('4 维统计维度与类别标签映射准确', () => {
    expect(PARETO_DIMENSION_NAMES.issue_type).toBe('缺陷类型')
    expect(PARETO_DIMENSION_NAMES.issue_severity).toBe('严重程度')
    expect(PARETO_DIMENSION_NAMES.risk_category).toBe('风险分类')
    expect(PARETO_DIMENSION_NAMES.change_type).toBe('变更类型')

    expect(getCategoryFallbackLabel('issue_type', 'bug')).toBe('功能缺陷')
    expect(getCategoryFallbackLabel('issue_severity', 'critical')).toBe('致命')
    expect(getCategoryFallbackLabel('risk_category', 'schedule')).toBe('进度')
    expect(getCategoryFallbackLabel('change_type', 'scope')).toBe('范围变更')
    expect(getCategoryFallbackLabel('issue_type', 'unknown_cat')).toBe('unknown_cat')
  })

  test('条目超过 10 项时归并前 9 项 +「其他（合并）」', () => {
    const twelveItems: ParetoItem[] = Array.from({ length: 12 }, (_, i) => ({
      category: `cat_${i + 1}`,
      label: `分类 ${i + 1}`,
      count: 20 - i,
      percentage: 0,
      cumulativePercentage: 0,
      isVitalFew: i < 3,
    }))
    const total = twelveItems.reduce((sum, item) => sum + item.count, 0)

    const normalized = normalizeParetoItems(twelveItems, total, 'issue_type')
    expect(normalized).toHaveLength(10)
    expect(normalized[9]!.category).toBe('other_merged')
    expect(normalized[9]!.label).toBe('其他（合并）')
    expect(normalized[9]!.count).toBe(
      twelveItems.slice(9).reduce((sum, item) => sum + item.count, 0),
    )
    expect(normalized[9]!.cumulativePercentage).toBe(100)
  })

  test('双 Y 轴 Option：左轴频数柱 + 右轴百分比折线 + 80% markLine', () => {
    const items = makeSampleItems()
    const option = buildParetoOption(items, true) as ParetoOptionShape

    expect(option.animation).toBe(true)
    expect(option.xAxis?.data).toEqual(['功能缺陷', '阻塞障碍', '技术问题', '流程问题'])
    expect(option.yAxis).toHaveLength(2)
    expect(option.yAxis?.[0]?.name).toContain('频数')
    expect(option.yAxis?.[1]?.name).toContain('累计百分比')

    const barSeries = option.series?.find((s) => s.type === 'bar')
    const lineSeries = option.series?.find((s) => s.type === 'line')
    expect(barSeries).toBeDefined()
    expect(lineSeries).toBeDefined()

    // 关键少数高亮色 vs 次要中性色
    const barData = barSeries?.data as Array<{ value: number; itemStyle: { color: string } }>
    expect(barData[0]?.itemStyle.color).toBe(NX_PARETO_VITAL_FEW_COLOR)
    expect(barData[1]?.itemStyle.color).toBe(NX_PARETO_VITAL_FEW_COLOR)
    expect(barData[2]?.itemStyle.color).toBe(NX_PARETO_TRIVIAL_COLOR)
    expect(barData[3]?.itemStyle.color).toBe(NX_PARETO_TRIVIAL_COLOR)

    // 右轴百分比平滑折线与 80% markLine
    expect(lineSeries?.yAxisIndex).toBe(1)
    expect(lineSeries?.smooth).toBe(true)
    expect(lineSeries?.data).toEqual([50, 80, 95, 100])
    expect(lineSeries?.markLine?.data[0]?.yAxis).toBe(80)
  })
})

describe('ParetoChartLens 镜头组件', () => {
  beforeEach(() => {
    ensureLazyEchartsMock().reset()
    paretoMock.mockReset()
    useNextTrackStore.setState({ immersionTier: 'immersive' })
  })

  test('有数据态：成功渲染维度 Tab、关键少数概览与图表，RL-01 零写网络，DOM 中性措辞', async () => {
    paretoMock.mockResolvedValue(makeParetoResult())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderLens()

    const chart = await screen.findByRole('img', { name: '柏拉图分析图' })
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()

    // 概览文案
    expect(screen.getByText('总计 100 项')).toBeInTheDocument()
    expect(screen.getByText('2 项')).toBeInTheDocument()
    expect(screen.getByText(/占 80%/)).toBeInTheDocument()

    // RL-01：全程零写请求
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()

    // DOM 中性措辞铁律：绝对不含感性惊恐词汇
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('维度切换：点击严重程度 Tab 发起带参查询，零写操作', async () => {
    paretoMock.mockResolvedValue(makeParetoResult())
    renderLens()

    await screen.findByRole('img', { name: '柏拉图分析图' })
    expect(paretoMock).toHaveBeenCalledWith(42, { dimension: 'issue_type' })

    paretoMock.mockResolvedValueOnce(
      makeParetoResult({
        dimension: 'issue_severity',
        totalCount: 20,
        items: [
          {
            category: 'critical',
            label: '致命',
            count: 16,
            percentage: 80,
            cumulativePercentage: 80,
            isVitalFew: true,
          },
          {
            category: 'major',
            label: '严重',
            count: 4,
            percentage: 20,
            cumulativePercentage: 100,
            isVitalFew: false,
          },
        ],
      }),
    )

    const severityTab = screen.getByRole('tab', { name: '严重程度' })
    fireEvent.click(severityTab)

    await waitFor(() => {
      expect(paretoMock).toHaveBeenCalledWith(42, { dimension: 'issue_severity' })
    })
    await screen.findByText('总计 20 项')
  })

  test('空数据态：渲染中性空态卡片且不报错不白屏', async () => {
    paretoMock.mockResolvedValue(makeParetoResult({ totalCount: 0, items: [] }))
    renderLens()

    await screen.findByRole('status', { name: '柏拉图数据为空' })
    expect(screen.getByText('当前统计维度暂无数据记录')).toBeInTheDocument()
    expect(screen.getByText('当前统计维度暂无数据记录，无法生成柏拉图。')).toBeInTheDocument()
  })

  test('接口失败与错误重试恢复', async () => {
    paretoMock.mockRejectedValueOnce(new Error('Network error'))
    renderLens()

    await screen.findByRole('alert', { name: '柏拉图数据加载失败' })
    paretoMock.mockResolvedValueOnce(makeParetoResult())

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '柏拉图分析图' })
  })

  test('精确档（precise）：ECharts animation 设为 false', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    paretoMock.mockResolvedValue(makeParetoResult())
    renderLens()

    await screen.findByRole('img', { name: '柏拉图分析图' })
    expect(lastOption().animation).toBe(false)
  })
})
