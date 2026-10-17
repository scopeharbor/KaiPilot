/**
 * v3-ui-next-chart-gallery W2 · tasks 2.6 —— 里程碑时间轴泳道镜头测试。
 *
 * 覆盖：
 * - 纯函数轴模型：日期线性定位、同日微偏移、年月旬标尺、时间域外扩、
 *   未排期收纳与达成率分组统计；
 * - 组件：五状态菱形旗帜/文字映射、进度环 + 任务数徽章、严格线性 DOM 排布、
 *   点击呼出详情（未完成任务清单）、未排期泳区、加载/空态/错误、零写保护、
 *   精确档关闭脉冲。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import { useNextTrackStore } from '@/stores/next-track-store'
import { computeMilestoneAxis, pxPerDayOf } from '@/lib/next/charts/milestone-timeline-adapter'
import { MilestoneTimelineChartLens } from '@/components/next/charts/lenses/MilestoneTimelineChartLens'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const milestonesListMock = vi.hoisted(() => vi.fn())
const tasksListMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/milestones', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/milestones')>()
  return { ...original, milestonesApi: { ...original.milestonesApi, list: milestonesListMock } }
})
vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...original, tasksApi: { ...original.tasksApi, list: tasksListMock } }
})

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeMilestone(id: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: 42,
    name: `里程碑 ${id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: '2026-10-01',
    autoCalculated: false,
    displayOrder: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

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
    progressPercent: 30,
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

/** 五状态全覆盖（含同日第二颗 + 未排期）。 */
const MILESTONES: Milestone[] = [
  makeMilestone(1, { name: '需求冻结', status: 'achieved', plannedDate: '2026-09-10' }),
  makeMilestone(2, { name: '联调通过', status: 'at_risk', plannedDate: '2026-10-05' }),
  makeMilestone(3, { name: '验收发布', status: 'missed', plannedDate: '2026-10-25' }),
  makeMilestone(4, { name: '版本转产', status: 'planned', plannedDate: '2026-11-30' }),
  makeMilestone(5, { name: '复盘评审', status: 'not_started', plannedDate: '2026-09-10' }),
  makeMilestone(6, { name: '培训交接', status: 'planned', plannedDate: null }),
]

/** 里程碑 1 关联：2 已完成 + 1 进行中 + 1 已取消（不计入分母）。 */
const MILESTONE_TASKS: Task[] = [
  makeTask(11, { name: '需求文档终稿', status: 'completed', progressPercent: 100, milestoneId: 1 }),
  makeTask(12, { name: '原型评审通过', status: 'completed', progressPercent: 100, milestoneId: 1 }),
  makeTask(13, { name: '排期评审', status: 'in_progress', milestoneId: 1 }),
  makeTask(14, { name: '已取消需求', status: 'cancelled', milestoneId: 1 }),
  makeTask(21, { name: '联调冒烟', status: 'completed', progressPercent: 100, milestoneId: 2 }),
]

const page = (data: unknown[]) => ({
  data,
  meta: { total: data.length, page: 1, perPage: 100, totalPages: 1 },
})

function renderLens(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MilestoneTimelineChartLens projectId={42} />
    </QueryClientProvider>,
  )
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  milestonesListMock.mockReset()
  tasksListMock.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
})

// ---------------------------------------------------------------------------
// 纯函数：时间轴几何与达成统计
// ---------------------------------------------------------------------------

describe('milestone-timeline-adapter 纯函数', () => {
  test('日期升序线性定位 + 同日微偏移 + 时间域外扩', () => {
    const model = computeMilestoneAxis(MILESTONES, MILESTONE_TASKS)
    expect(model).not.toBeNull()
    expect(model?.nodes).toHaveLength(5)
    const centers = model?.nodes.map((node) => node.centerPx) ?? []
    for (let index = 1; index < centers.length; index += 1) {
      expect(centers[index]!).toBeGreaterThan(centers[index - 1]!)
    }
    // 2026-09-10 同日两节点：第二颗整体右移 SAME_DAY_NUDGE_PX=26
    const sameDayNodes = model?.nodes.filter((node) => node.milestone.plannedDate === '2026-09-10')
    expect(sameDayNodes).toHaveLength(2)
    expect(sameDayNodes![1]!.centerPx - sameDayNodes![0]!.centerPx).toBe(26)
    // 时间域含双侧 7% 边距，首节点不贴边
    expect(model?.totalDays).toBeGreaterThan(80)
    expect(model?.pxPerDay).toBe(pxPerDayOf(model?.totalDays ?? 0))
    // 未排期收纳（displayOrder 升序）
    expect(model?.undated).toHaveLength(1)
    expect(model?.undated[0]?.milestone.id).toBe(6)
  })

  test('达成率口径：completed/分母排除 cancelled，未完成任务置前', () => {
    const model = computeMilestoneAxis([MILESTONES[0]!], MILESTONE_TASKS)
    const progress = model?.nodes[0]?.progress
    expect(progress?.total).toBe(3)
    expect(progress?.completed).toBe(2)
    expect(progress?.percent).toBe(66)
    expect(progress?.tasks.map((task) => task.id)).toEqual([13, 11, 12])
  })

  test('年月旬标尺月段：首段带年份、含 11/21 旬刻度', () => {
    const model = computeMilestoneAxis(MILESTONES, MILESTONE_TASKS)
    const months = model?.months ?? []
    expect(months.length).toBeGreaterThanOrEqual(3)
    const first = months[0]
    expect(first?.label).toContain('2026年')
    expect(months[1]?.label).not.toContain('年')
    // 非截断月段应含 11 与 21 日旬刻度
    const fullMonth = months.find((month) => month.days >= 28)
    expect(fullMonth?.tickDayIndexes).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]),
    )
  })

  test('无里程碑返回 null；仅未排期返回空轴模型', () => {
    expect(computeMilestoneAxis([], [])).toBeNull()
    const onlyUndated = computeMilestoneAxis([MILESTONES[5]!], [])
    expect(onlyUndated?.nodes).toEqual([])
    expect(onlyUndated?.undated).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 组件：五状态旗帜 + 进度环 + 详情
// ---------------------------------------------------------------------------

describe('MilestoneTimelineChartLens 泳道渲染（spec 场景）', () => {
  test('渲染标尺与线性排布的旗帜节点，五状态映射 + 进度环', async () => {
    milestonesListMock.mockResolvedValue(page(MILESTONES))
    tasksListMock.mockResolvedValue(page(MILESTONE_TASKS))
    renderLens(createClient())

    // 标尺（年-月-旬）
    const ruler = await screen.findByRole('img', { name: /里程碑时间标尺/ })
    expect(ruler).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ruler-month]').length).toBeGreaterThanOrEqual(3)

    // 五颗日期节点严格按日期线性排布（DOM 顺序 left 单调递增）
    const nodes = document.querySelectorAll('[data-milestone-node]')
    expect(nodes).toHaveLength(5)
    const lefts = Array.from(nodes).map((node) =>
      parseFloat((node.closest('[data-milestone-node-column]') as HTMLElement)?.style.left ?? '0'),
    )
    for (let index = 1; index < lefts.length; index += 1) {
      expect(lefts[index]!).toBeGreaterThan(lefts[index - 1]!)
    }
    // 状态属性齐全
    const statuses = Array.from(nodes).map((node) => node.getAttribute('data-status'))
    expect(statuses).toEqual(
      expect.arrayContaining(['achieved', 'at_risk', 'missed', 'planned', 'not_started']),
    )
    // 图例五项（色盲可辨文字标签）
    const legend = document.querySelector('[data-milestone-legend]')
    for (const label of ['未开始', '计划中', '有风险', '已达成', '已逾期']) {
      expect(legend?.textContent).toContain(label)
    }

    // 进度环与徽章：里程碑 1 = 2/3 达成（66%）
    const ring = await screen.findByRole('img', {
      name: /需求冻结 关联任务达成率 66%/,
    })
    expect(ring).toBeInTheDocument()
    expect(document.querySelector('[data-milestone-task-badge="1"]')?.textContent).toContain('2/3')
    // 里程碑 2 关联 1 个已完成任务 → 100%
    expect(screen.getByRole('img', { name: /联调通过 关联任务达成率 100%/ })).toBeInTheDocument()
    // 任务徽章 1/1（cancelled 不计）
    expect(document.querySelector('[data-milestone-task-badge="2"]')?.textContent).toContain('1/1')

    // 未排期里程碑收纳在独立泳区
    expect(document.querySelector('[data-milestone-undated]')).not.toBeNull()
    expect(document.querySelector('[data-milestone-undated-node="6"]')?.textContent).toContain(
      '培训交接',
    )
  })

  test('at_risk 沉浸档有脉冲标识，精确档关闭', async () => {
    milestonesListMock.mockResolvedValue(page(MILESTONES))
    tasksListMock.mockResolvedValue(page(MILESTONE_TASKS))
    const firstView = renderLens(createClient())
    await firstView.findByRole('img', { name: /里程碑时间标尺/ })
    expect(firstView.baseElement.querySelectorAll('[data-milestone-pulse]')).toHaveLength(1)
    firstView.unmount()

    // 精确档（spec：关闭呼吸脉冲，数据静止）
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const view = renderLens(createClient())
    await waitFor(() =>
      expect(view.baseElement.querySelector('[data-milestone-axis]')).not.toBeNull(),
    )
    expect(view.baseElement.querySelectorAll('[data-milestone-pulse]')).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('点击旗帜呼出详情：目标日期/状态/未完成任务清单；可关闭', async () => {
    milestonesListMock.mockResolvedValue(page(MILESTONES))
    tasksListMock.mockResolvedValue(page(MILESTONE_TASKS))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderLens(createClient())

    const node = await screen.findByRole('button', { name: /需求冻结/ })
    fireEvent.click(node)

    const detail = await screen.findByRole('region', { name: '里程碑详情：需求冻结' })
    expect(detail).toBeInTheDocument()
    expect(detail.textContent).toContain('2026-09-10')
    expect(detail.textContent).toContain('已达成')
    expect(detail.textContent).toContain('达成率 66%')
    // 任务清单：未完成置前（带 data-unfinished），已完成随后，cancelled 不计
    const rows = Array.from(detail.querySelectorAll('[data-milestone-task-row]'))
    expect(rows).toHaveLength(3)
    expect(rows[0]?.getAttribute('data-milestone-task-row')).toBe('13')
    expect(rows[0]?.getAttribute('data-unfinished')).not.toBeNull()
    expect(rows[1]?.textContent).toContain('需求文档终稿')
    expect(rows[1]?.getAttribute('data-unfinished')).toBeNull()
    // 关闭
    fireEvent.click(screen.getByRole('button', { name: '关闭里程碑详情' }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '里程碑详情：需求冻结' })).toBeNull(),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('点击未排期徽章同样呼出详情', async () => {
    milestonesListMock.mockResolvedValue(page(MILESTONES))
    tasksListMock.mockResolvedValue(page(MILESTONE_TASKS))
    renderLens(createClient())
    await screen.findByRole('img', { name: /里程碑时间标尺/ })

    fireEvent.click(screen.getByRole('button', { name: /培训交接/ }))
    const detail = await screen.findByRole('region', { name: '里程碑详情：培训交接' })
    expect(detail.textContent).toContain('未排期')
    expect(detail.textContent).toContain('该里程碑暂无关联任务。')
  })

  test('里程碑为空 → 语义空态与时间线引导，任务查询零发出', async () => {
    milestonesListMock.mockResolvedValue(page([]))
    renderLens(createClient())

    await screen.findByRole('status', { name: '里程碑数据为空' })
    expect(screen.getByText('当前项目暂无里程碑')).toBeInTheDocument()
    expect(tasksListMock).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lens-empty-guide]')?.getAttribute('href')).toBe(
      '/next/projects/42?lens=timeline',
    )
  })

  test('接口 500 → 错误卡 + 重新加载恢复', async () => {
    milestonesListMock
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(page(MILESTONES))
    tasksListMock.mockResolvedValue(page(MILESTONE_TASKS))
    renderLens(createClient())

    const alert = await screen.findByRole('alert', { name: '里程碑时间轴加载失败' })
    expect(alert).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('img', { name: /里程碑时间标尺/ })
    expect(milestonesListMock).toHaveBeenCalledTimes(2)
    expect(tasksListMock).toHaveBeenCalledTimes(1)
  })
})
