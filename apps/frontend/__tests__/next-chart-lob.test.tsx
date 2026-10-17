/**
 * 线条平衡图 (LOB) 镜头定向测试（v3-chart-gallery-tier2-pareto-lob W2 · task 2.4）。
 *
 * 覆盖：
 * - Adapter 纯函数：空间单元自然序（compareNatural）、工序推进斜率折线、工序交叉几何打结
 *   视觉呈现、客观中性诊断映射；
 * - 组件渲染：工序节奏概览卡片、主视口线条平衡图 ECharts 初始化；
 * - RL-01 零写网络断言：查询全程零写操作（POST/PUT/PATCH/DELETE）；
 * - DOM 中性措辞断言：绝对零「感性惊恐词汇」（告警/预警/危险等）；
 * - 空态降级与错误重试；
 * - 精确档（precise）animation: false。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { LobMetricsResponse } from '@/lib/api/project-metrics'
import { buildLobOption, compareNatural, lobDiagnosticLabel } from '@/lib/next/charts/lob-adapter'
import { LobChartLens } from '@/components/next/charts/lenses/LobChartLens'
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

const lobMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: {
      ...original.projectMetricsApi,
      lob: lobMock,
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeLobResponse(overrides: Partial<LobMetricsResponse> = {}): LobMetricsResponse {
  return {
    units: ['Floor-10', 'Floor-1', 'Floor-2'],
    stages: ['砌筑工程', '抹灰工程'],
    activities: [
      {
        taskId: 101,
        taskName: '1F砌筑',
        unit: 'Floor-1',
        stage: '砌筑工程',
        plannedStart: '2026-09-01',
        plannedEnd: '2026-09-03',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.33,
      },
      {
        taskId: 102,
        taskName: '2F砌筑',
        unit: 'Floor-2',
        stage: '砌筑工程',
        plannedStart: '2026-09-05',
        plannedEnd: '2026-09-07',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.25,
      },
      {
        taskId: 103,
        taskName: '10F砌筑',
        unit: 'Floor-10',
        stage: '砌筑工程',
        plannedStart: '2026-09-09',
        plannedEnd: '2026-09-11',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.25,
      },
      {
        taskId: 201,
        taskName: '1F抹灰',
        unit: 'Floor-1',
        stage: '抹灰工程',
        plannedStart: '2026-09-04',
        plannedEnd: '2026-09-06',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.33,
      },
      {
        taskId: 202,
        taskName: '2F抹灰',
        unit: 'Floor-2',
        stage: '抹灰工程',
        plannedStart: '2026-09-06',
        plannedEnd: '2026-09-08',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.5,
      },
      {
        taskId: 203,
        taskName: '10F抹灰',
        unit: 'Floor-10',
        stage: '抹灰工程',
        plannedStart: '2026-09-08',
        plannedEnd: '2026-09-10',
        actualStart: null,
        actualEnd: null,
        durationDays: 3,
        slopeRate: 0.5,
      },
    ],
    rhythmSummary: [
      {
        stage: '砌筑工程',
        activityCount: 3,
        avgDurationDays: 3,
        avgTaktDays: 4,
        collision: false,
        gap: false,
        diagnostics: [],
      },
      {
        stage: '抹灰工程',
        activityCount: 3,
        avgDurationDays: 3,
        avgTaktDays: 2,
        collision: true,
        gap: false,
        diagnostics: ['STAGE_COLLISION'],
      },
    ],
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
      <LobChartLens projectId={projectId} />
    </QueryClientProvider>,
  )
}

interface LobOptionShape {
  animation?: boolean
  xAxis?: { data?: string[] }
  yAxis?: { type?: string }
  series?: Array<{
    name?: string
    smooth?: boolean
    data?: Array<string | null>
  }>
}

function lastOption(): LobOptionShape {
  return (ensureLazyEchartsMock().lastOption ?? {}) as LobOptionShape
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LOB 线条平衡图适配器纯函数', () => {
  test('空间单元自然排序：Floor-1 < Floor-2 < Floor-10', () => {
    const raw = ['Floor-10', 'Floor-1', 'Floor-2']
    const sorted = [...raw].sort(compareNatural)
    expect(sorted).toEqual(['Floor-1', 'Floor-2', 'Floor-10'])
  })

  test('客观中性诊断术语映射', () => {
    expect(lobDiagnosticLabel('STAGE_COLLISION')).toBe('工序时窗重叠')
    expect(lobDiagnosticLabel('STAGE_GAP')).toBe('工序间隔变动')
  })

  test('ECharts Option 构建：空间单元为 X 轴，时间为 Y 轴，工序为斜率折线', () => {
    const response = makeLobResponse()
    const option = buildLobOption(response, true) as LobOptionShape

    expect(option.animation).toBe(true)
    expect(option.xAxis?.data).toEqual(['Floor-1', 'Floor-2', 'Floor-10'])
    expect(option.yAxis?.type).toBe('time')
    expect(option.series).toHaveLength(2)

    const stage1Series = option.series?.find((s) => s.name === '砌筑工程')
    const stage2Series = option.series?.find((s) => s.name === '抹灰工程')
    expect(stage1Series).toBeDefined()
    expect(stage2Series).toBeDefined()

    // 纯几何直线（非平滑曲线，反映工序实际推进速率）
    expect(stage1Series?.smooth).toBe(false)
    expect(stage2Series?.smooth).toBe(false)

    // 数据点对应空间单元顺序
    expect(stage1Series?.data).toEqual(['2026-09-01', '2026-09-05', '2026-09-09'])
    expect(stage2Series?.data).toEqual(['2026-09-04', '2026-09-06', '2026-09-08'])
  })
})

describe('LobChartLens 镜头组件', () => {
  beforeEach(() => {
    ensureLazyEchartsMock().reset()
    lobMock.mockReset()
    useNextTrackStore.setState({ immersionTier: 'immersive' })
  })

  test('完整工序项目：正确渲染节拍诊断卡与图表，RL-01 零写网络，DOM 中性措辞', async () => {
    lobMock.mockResolvedValue(makeLobResponse())
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    renderLens()

    const chart = await screen.findByRole('img', { name: '线条平衡图' })
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()

    // 节拍指标卡验证
    expect(screen.getByText('砌筑工程')).toBeInTheDocument()
    expect(screen.getByText('抹灰工程')).toBeInTheDocument()
    expect(screen.getByText('工序时窗重叠')).toBeInTheDocument()

    // RL-01：全程零写网络请求
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()

    // DOM 中性措辞铁律：绝对不含感性惊恐词汇
    expect(screen.queryByText(/告警|预警|严重警告|危险/)).toBeNull()
  })

  test('无流水任务项目：友好中性空态降级，不报错不白屏', async () => {
    lobMock.mockResolvedValue(
      makeLobResponse({ units: [], stages: [], activities: [], rhythmSummary: [] }),
    )
    renderLens()

    await screen.findByRole('status', { name: '线条平衡图数据为空' })
    expect(screen.getByText('当前项目暂无流水工序数据')).toBeInTheDocument()
    expect(
      screen.getByText('当前项目任务未设置空间单元或工序阶段，线条平衡图暂无法计算。'),
    ).toBeInTheDocument()
  })

  test('接口失败：错误卡片及重新加载恢复', async () => {
    lobMock.mockRejectedValueOnce(new Error('Network error'))
    renderLens()

    await screen.findByRole('alert', { name: '线条平衡图数据加载失败' })
    lobMock.mockResolvedValueOnce(makeLobResponse())

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '线条平衡图' })
  })

  test('精确档（precise）：ECharts animation 设为 false', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    lobMock.mockResolvedValue(makeLobResponse())
    renderLens()

    await screen.findByRole('img', { name: '线条平衡图' })
    expect(lastOption().animation).toBe(false)
  })
})
