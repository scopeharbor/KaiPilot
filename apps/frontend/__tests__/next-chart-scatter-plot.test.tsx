/**
 * v3-ui-next-chart-gallery W2 · tasks 2.4 —— 双变量散布图镜头测试。
 *
 * 覆盖：
 * - 工时/成本/风险三维度切换与数据映射（tasks + risks 端点，纯 GET）；
 * - 工时/成本维度 Y=X 45° 理想对角线 + X/Y 均值象限参考线；
 * - 风险维度半径按 score 缩放、颜色按敞口分档（低/中/高/极高）+ 语义徽章；
 * - Tooltip 偏差百分比与敞口文案；空态/错误重试；交互期间零网络写请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Risk } from '@/lib/api/risks'
import type { Task } from '@/lib/api/tasks'
import { ScatterPlotChartLens } from '@/components/next/charts/lenses/ScatterPlotChartLens'
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

const tasksListMock = vi.hoisted(() => vi.fn())
const risksListMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...original, tasksApi: { ...original.tasksApi, list: tasksListMock } }
})
vi.mock('@/lib/api/risks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/risks')>()
  return { ...original, listRisks: risksListMock }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 42,
    name: `任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const HOUR_TASKS: Task[] = [
  makeTask(1, { name: '核心引擎重构', estimatedHours: 10, actualHours: 12 }),
  makeTask(2, { name: '接口联调', estimatedHours: 8, actualHours: 8 }),
  makeTask(3, { name: '性能压测', estimatedHours: 5, actualHours: 2 }),
  // 未记录实耗：过滤（不入散点）
  makeTask(4, { name: '需求梳理', estimatedHours: 6, actualHours: null }),
]

const COST_TASKS: Task[] = [
  makeTask(1, {
    name: '核心引擎重构',
    estimatedHours: 10,
    actualHours: 12,
    costEstimateCents: 10_000,
    costActualCents: 15_000,
  }),
  makeTask(2, {
    name: '接口联调',
    estimatedHours: 8,
    actualHours: 8,
    costEstimateCents: 20_000,
    costActualCents: 10_000,
  }),
  makeTask(3, {
    name: '性能压测',
    estimatedHours: 5,
    actualHours: 2,
    costEstimateCents: 0,
    costActualCents: 3_000,
  }),
]

const RISKS: Risk[] = [
  {
    id: 1,
    organizationId: 1,
    projectId: 42,
    riskCode: 'R-001',
    title: '核心依赖延期风险',
    description: '',
    category: 'schedule',
    probability: 5,
    impact: 5,
    score: 25,
    status: 'analyzing',
    mitigationStrategy: null,
    contingencyPlan: null,
    ownerId: null,
    triggerEvent: null,
    residualProbability: null,
    residualImpact: null,
    residualScore: null,
    identifiedAt: '2026-08-01T00:00:00.000Z',
    targetResolutionDate: null,
    resolvedAt: null,
    relatedTaskId: null,
    aiMetadata: null,
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 2,
    organizationId: 1,
    projectId: 42,
    riskCode: 'R-002',
    title: '招聘节奏不确定',
    description: '',
    category: 'resource',
    probability: 3,
    impact: 3,
    score: 9,
    status: 'identified',
    mitigationStrategy: null,
    contingencyPlan: null,
    ownerId: null,
    triggerEvent: null,
    residualProbability: null,
    residualImpact: null,
    residualScore: null,
    identifiedAt: '2026-08-02T00:00:00.000Z',
    targetResolutionDate: null,
    resolvedAt: null,
    relatedTaskId: null,
    aiMetadata: null,
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
]

const page = (data: unknown[]) => ({
  data,
  meta: { total: data.length, page: 1, perPage: 100, totalPages: 1 },
})

function renderLens(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ScatterPlotChartLens projectId={42} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

interface ScatterOptionShape {
  series?: Array<{
    type?: string
    data?: Array<{ value?: [number, number]; symbolSize?: number; itemStyle?: { color?: string } }>
    markLine?: { data?: Array<{ coord?: [number, number]; xAxis?: number; yAxis?: number }> }
  }>
  xAxis?: { min?: number; max?: number; name?: string }
  yAxis?: { min?: number; max?: number; name?: string }
  tooltip?: { formatter?: (params: unknown) => string }
}

function scatterOption(): ScatterOptionShape {
  return (ensureLazyEchartsMock().lastOption ?? {}) as ScatterOptionShape
}

beforeEach(() => {
  ensureLazyEchartsMock().reset()
  tasksListMock.mockReset()
  risksListMock.mockReset()
})

describe('散布图工时/成本/风险三维度（spec 场景）', () => {
  test('工时维度：任务散点映射 + Y=X 对角线 + X/Y 均值象限线', async () => {
    tasksListMock.mockResolvedValue(page(HOUR_TASKS))
    renderLens(createClient())

    const chart = await screen.findByRole('img', { name: '预估工时 vs 实际工时散布图' })
    expect(tasksListMock).toHaveBeenCalledTimes(1)
    expect(tasksListMock).toHaveBeenCalledWith(42, {
      page: 1,
      perPage: 100,
      sort: '+id',
    })
    expect(risksListMock).not.toHaveBeenCalled()
    expect(chart.querySelector('[data-echarts-mock-rendered]')).not.toBeNull()

    const option = scatterOption()
    const series = option.series?.[0]
    expect(series?.type).toBe('scatter')
    // 未记录实耗任务被过滤：3 点
    expect(series?.data).toHaveLength(3)
    expect(series?.data?.map((item) => item.value)).toEqual([
      [10, 12],
      [8, 8],
      [5, 2],
    ])
    // Y=X 理想对角线：coords 跨数据域两端且坐标相等（数据坐标 45°）
    const marks = series?.markLine?.data ?? []
    expect(marks.length).toBe(4)
    const diagCoords = marks.filter((mark): mark is { coord: [number, number] } =>
      Array.isArray(mark.coord),
    )
    expect(diagCoords).toHaveLength(2)
    for (const mark of diagCoords) {
      expect(mark.coord[0]).toBe(mark.coord[1])
    }
    expect(diagCoords[1]!.coord[0]).toBeGreaterThan(diagCoords[0]!.coord[0])
    // 均值线：X 均值 (10+8+5)/3=7.67 / Y 均值 (12+8+2)/3=7.33
    const meanXs = marks.filter((mark) => typeof mark.xAxis === 'number')
    const meanYs = marks.filter((mark) => typeof mark.yAxis === 'number')
    expect(meanXs).toHaveLength(1)
    expect(meanYs).toHaveLength(1)
    expect(meanXs[0]?.xAxis).toBeCloseTo(7.67, 1)
    expect(meanYs[0]?.yAxis).toBeCloseTo(7.33, 1)

    // Tooltip 偏差百分比（超支 +20%）
    const formatter = option.tooltip?.formatter
    const html = formatter?.({ dataIndex: 0 }) ?? ''
    expect(html).toContain('核心引擎重构')
    expect(html).toContain('超支/延期 20%')
    const underHtml = formatter?.({ dataIndex: 2 }) ?? ''
    expect(underHtml).toContain('结余/提速 60%')
  })

  test('成本维度：分→元换算 + 徽章计数', async () => {
    tasksListMock.mockResolvedValue(page(COST_TASKS))
    renderLens(createClient())
    await screen.findByRole('img', { name: '预估工时 vs 实际工时散布图' })

    fireEvent.click(screen.getByRole('tab', { name: '成本偏差' }))
    await screen.findByRole('img', { name: '估算成本 vs 实际成本散布图' })
    // 缓存命中，不重复拉任务
    expect(tasksListMock).toHaveBeenCalledTimes(1)

    const option = scatterOption()
    const data = option.series?.[0]?.data ?? []
    expect(data.map((item) => item.value)).toEqual([
      [100, 150],
      [200, 100],
      [0, 30],
    ])
    // 语义徽章：超支 1（150>100）· 结余 1（100<200；零估算不入偏差）
    expect(screen.getByText('超支/延期')).toBeInTheDocument()
    expect(screen.getByText('结余/提速')).toBeInTheDocument()
  })

  test('风险维度：score 半径缩放 + 敞口分档颜色与语义徽章', async () => {
    risksListMock.mockResolvedValue(page(RISKS))
    tasksListMock.mockResolvedValue(page([]))
    renderLens(createClient())
    // 初始工时维度：无任务 → 空态
    await screen.findByRole('status', { name: '散布图数据为空' })

    fireEvent.click(screen.getByRole('tab', { name: '风险敞口' }))
    await screen.findByRole('img', { name: '风险发生概率 vs 影响度散布图' })
    expect(risksListMock).toHaveBeenCalledTimes(1)
    // 任务维度查询停止启用
    expect(screen.getByText('半径 = 综合得分缩放 · 颜色 = 敞口分档')).toBeInTheDocument()

    const option = scatterOption()
    const data = option.series?.[0]?.data ?? []
    expect(data).toHaveLength(2)
    const critical = data[0]
    const medium = data[1]
    expect(critical?.value).toEqual([5, 5])
    // 得分 25 为最大值 → 半径 18；得分 9 → (6 + 9/25*12)=10.32 → 10.3
    expect(critical?.symbolSize).toBe(18)
    expect(critical?.itemStyle?.color).toBe('#ef4444')
    expect(medium?.symbolSize).toBeCloseTo(10.3, 1)
    expect(medium?.itemStyle?.color).toBe('#fbbf24')
    // 风险维度无 Y=X / 均值线（discrete 1-5 坐标）
    expect(option.series?.[0]?.markLine).toBeUndefined()
    // 语义徽章（色盲可辨）
    expect(screen.getByText('极高风险')).toBeInTheDocument()
    expect(screen.getByText('中风险')).toBeInTheDocument()

    // Tooltip 敞口文案
    const formatter = option.tooltip?.formatter
    const html = formatter?.({ dataIndex: 0 }) ?? ''
    expect(html).toContain('核心依赖延期风险')
    expect(html).toContain('敞口得分')
    expect(html).toContain('25 · 极高风险')
  })
})

describe('散布图空态 / 错误恢复 / 只读零写', () => {
  test('无任何任务 → 空态卡片与甘特引导', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    tasksListMock.mockResolvedValue(page([]))
    renderLens(createClient())

    await screen.findByRole('status', { name: '散布图数据为空' })
    expect(screen.getByText('当前项目暂无任务数据')).toBeInTheDocument()
    const guide = document.querySelector('[data-lens-empty-guide]')
    expect(guide).not.toBeNull()
    expect(guide?.getAttribute('href')).toBe('/next/projects/42?lens=gantt')
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('任务存在但无实耗记录 → 维度空态', async () => {
    tasksListMock.mockResolvedValue(page([makeTask(1, { estimatedHours: 6, actualHours: null })]))
    renderLens(createClient())

    await screen.findByRole('status', { name: '散布图数据为空' })
    expect(screen.getByText('暂无同时记录预估与实际工时的任务')).toBeInTheDocument()
  })

  test('风险为空 → 风险维度空态', async () => {
    tasksListMock.mockResolvedValue(page([]))
    risksListMock.mockResolvedValue(page([]))
    renderLens(createClient())
    await screen.findByRole('status', { name: '散布图数据为空' })

    fireEvent.click(screen.getByRole('tab', { name: '风险敞口' }))
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '散布图数据为空' })).toBeInTheDocument()
    })
    expect(screen.getByText('当前项目尚未登记风险条目')).toBeInTheDocument()
  })

  test('风险接口 500 → 错误卡 + 重新加载恢复', async () => {
    tasksListMock.mockResolvedValue(page([]))
    risksListMock
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(page(RISKS))
    renderLens(createClient())
    await screen.findByRole('status', { name: '散布图数据为空' })

    fireEvent.click(screen.getByRole('tab', { name: '风险敞口' }))
    const alert = await screen.findByRole('alert', { name: '风险敞口数据加载失败' })
    expect(alert).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: '风险发生概率 vs 影响度散布图' })
    expect(risksListMock).toHaveBeenCalledTimes(2)
  })
})
