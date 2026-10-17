/**
 * v3-chart-gallery-tier2-timeseries-metrics W4 · task 4.1 —— EVM 实值管理镜头测试。
 *
 * 覆盖：
 * - Adapter 纯函数：分转元换算准确性、CV/SV 正负号与状态标签、S 曲线数据点
 *   （PV/EV/AC/EAC 预测）完整性与评估截点 markLine；
 * - 组件渲染：KPI 指标卡组、无基线中性提示、空态/错误重试；
 * - RL-01 零写网络断言：交互全程零 POST/PUT/PATCH/DELETE；
 * - 精确档（precise）ECharts animation=false；中性文案铁律（零告警/预警字样）。
 *
 * ECharts 以 jsdom 桩替换（__tests__/helpers/echarts-mock.ts）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EvmIndicators, EvmSCurveResult } from '@/lib/api/project-metrics'
import {
  buildEvmIndicatorViewModel,
  buildEvmSCurveOption,
  centsToYuan,
  evmCostStatusLabel,
  evmScheduleStatusLabel,
} from '@/lib/next/charts/evm-adapter'
import { EvmChartLens } from '@/components/next/charts/lenses/EvmChartLens'
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

const evmMock = vi.hoisted(() => vi.fn())
const evmSCurveMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: { ...original.projectMetricsApi, evm: evmMock, evmSCurve: evmSCurveMock },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeIndicators(overrides: Partial<EvmIndicators> = {}): EvmIndicators {
  return {
    projectId: 42,
    asOfDate: '2026-09-03',
    hasBaseline: true,
    bac: 1_000_000,
    pv: 600_000,
    ev: 550_000,
    ac: 500_000,
    cv: 50_000,
    sv: -50_000,
    cpi: 1.1,
    spi: 0.917,
    etc: 350_000,
    eac: 850_000,
    vac: 150_000,
    tcpi: 1.05,
    scheduleStatus: 'delayed',
    costStatus: 'under_budget',
    ...overrides,
  }
}

function makeSCurve(overrides: Partial<EvmSCurveResult> = {}): EvmSCurveResult {
  return {
    projectId: 42,
    asOfDate: '2026-09-03',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    hasBaseline: true,
    points: [
      { date: '2026-09-01', pv: 100_000, ev: 90_000, ac: 95_000, eacForecast: null },
      { date: '2026-09-02', pv: 200_000, ev: 150_000, ac: 140_000, eacForecast: null },
      { date: '2026-09-03', pv: 300_000, ev: 200_000, ac: 190_000, eacForecast: null },
      { date: '2026-09-04', pv: 400_000, ev: null, ac: null, eacForecast: 210_000 },
      { date: '2026-09-05', pv: 500_000, ev: null, ac: null, eacForecast: 230_000 },
    ],
    ...overrides,
  }
}

function renderLens(client: QueryClient, projectId = 42) {
  return render(
    <QueryClientProvider client={client}>
      <EvmChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

interface OptionShape {
  animation?: boolean
  xAxis?: { data?: unknown[] }
  series?: Array<{ name?: string; data?: unknown[]; markLine?: { data?: unknown[] } }>
}

function lastOption(): OptionShape {
  return (ensureLazyEchartsMock().lastOption ?? {}) as OptionShape
}

beforeEach(() => {
  ensureLazyEchartsMock().reset()
  evmMock.mockReset()
  evmSCurveMock.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('evm-adapter 纯函数（spec：分转元换算 / 状态标签 / S 曲线映射）', () => {
  test('centsToYuan：分转元 2 位小数换算', () => {
    expect(centsToYuan(1_000_000)).toBe(10_000)
    expect(centsToYuan(50_000)).toBe(500)
    expect(centsToYuan(-50_000)).toBe(-500)
  })

  test('buildEvmIndicatorViewModel：金额换算为元，比率透传，状态标签中性', () => {
    const model = buildEvmIndicatorViewModel(makeIndicators())
    expect(model.bacYuan).toBe(10_000)
    expect(model.pvYuan).toBe(6_000)
    expect(model.evYuan).toBe(5_500)
    expect(model.acYuan).toBe(5_000)
    expect(model.cvYuan).toBe(500)
    expect(model.svYuan).toBe(-500)
    expect(model.cpi).toBe(1.1)
    expect(model.spi).toBe(0.917)
    expect(evmScheduleStatusLabel('delayed')).toBe('进度滞后')
    expect(evmScheduleStatusLabel('ahead')).toBe('进度超前')
    expect(evmScheduleStatusLabel('on_track')).toBe('进度符合预期')
    expect(evmCostStatusLabel('under_budget')).toBe('成本结余')
    expect(evmCostStatusLabel('over_budget')).toBe('成本超支')
    expect(evmCostStatusLabel('on_track')).toBe('成本符合预期')
  })

  test('buildEvmSCurveOption：PV/EV/AC/EAC 预测四线完整性 + 评估截点 markLine', () => {
    const option = buildEvmSCurveOption(makeSCurve(), true) as unknown as OptionShape
    expect(option.animation).toBe(true)
    expect(option.xAxis?.data).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ])
    const [pv, ev, ac, forecast] = option.series ?? []
    expect(pv?.name).toBe('PV 计划值')
    expect(pv?.data).toEqual([1000, 2000, 3000, 4000, 5000])
    expect(ev?.name).toBe('EV 挣值')
    expect(ev?.data).toEqual([900, 1500, 2000, null, null])
    expect(ac?.name).toBe('AC 实际成本')
    expect(ac?.data).toEqual([950, 1400, 1900, null, null])
    expect(forecast?.name).toBe('EAC 完工预测')
    expect(forecast?.data).toEqual([null, null, null, 2100, 2300])
    expect(pv?.markLine?.data).toEqual([{ xAxis: '2026-09-03' }])
  })
})

describe('EvmChartLens 组件（spec 场景）', () => {
  test('完整基线项目：指标卡渲染换算后金额 + S 曲线渲染，零写网络', async () => {
    evmMock.mockResolvedValue(makeIndicators())
    evmSCurveMock.mockResolvedValue(makeSCurve())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderLens(createClient())

    const chart = await screen.findByRole('img', { name: '实值管理S曲线图' })
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()

    expect(document.querySelector('[data-evm-kpi-card="PV 计划值"]')?.textContent).toContain(
      '6,000.00',
    )
    expect(document.querySelector('[data-evm-kpi-card="EV 挣值"]')?.textContent).toContain(
      '5,500.00',
    )
    expect(document.querySelector('[data-evm-kpi-card="AC 实际成本"]')?.textContent).toContain(
      '5,000.00',
    )
    expect(document.querySelector('[data-evm-kpi-card="CV 成本偏差"]')?.textContent).toContain(
      '500.00',
    )
    expect(document.querySelector('[data-evm-kpi-card="SV 进度偏差"]')?.textContent).toContain(
      '-500.00',
    )
    expect(document.querySelector('[data-evm-kpi-card="CPI 成本绩效指数"]')?.textContent).toContain(
      '1.100',
    )
    expect(document.querySelector('[data-evm-kpi-card="SPI 进度绩效指数"]')?.textContent).toContain(
      '0.917',
    )
    expect(screen.getByText('成本结余')).toBeInTheDocument()
    expect(screen.getByText('进度滞后')).toBeInTheDocument()

    // 无基线提示不应出现（hasBaseline: true）
    expect(document.querySelector('[data-evm-baseline-hint]')).toBeNull()

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()

    // 中性文案铁律：零「告警/预警」字样
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('无基线项目：安全降级渲染中性提示，页面不崩溃', async () => {
    evmMock.mockResolvedValue(makeIndicators({ hasBaseline: false }))
    evmSCurveMock.mockResolvedValue(makeSCurve({ hasBaseline: false }))
    renderLens(createClient())

    await screen.findByRole('img', { name: '实值管理S曲线图' })
    expect(
      screen.getByText('当前项目尚未建立排期基线，指标基于当前任务成本估算推导。'),
    ).toBeInTheDocument()
  })

  test('S 曲线为空数组：语义空态', async () => {
    evmMock.mockResolvedValue(makeIndicators())
    evmSCurveMock.mockResolvedValue(makeSCurve({ points: [] }))
    renderLens(createClient())

    await screen.findByRole('status', { name: '实值管理数据为空' })
    expect(screen.getByText('当前项目暂无实值管理数据')).toBeInTheDocument()
  })

  test('接口失败：错误卡 + 重新加载恢复', async () => {
    evmMock.mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
    evmSCurveMock.mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
    renderLens(createClient())

    await screen.findByRole('alert', { name: '实值管理数据加载失败' })
    evmMock.mockResolvedValueOnce(makeIndicators())
    evmSCurveMock.mockResolvedValueOnce(makeSCurve())
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '实值管理S曲线图' })
  })

  test('精确档（precise）：ECharts animation=false 即时定格', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    evmMock.mockResolvedValue(makeIndicators())
    evmSCurveMock.mockResolvedValue(makeSCurve())
    renderLens(createClient())

    await screen.findByRole('img', { name: '实值管理S曲线图' })
    expect(lastOption().animation).toBe(false)
  })
})
