/**
 * v3-ui-next-batch3-global-convergence W3 · 任务 3.2
 * 全域时间序列合成工具纯函数与并发合成测试。
 *
 * 覆盖：
 * 1. 跨项目多数据源（里程碑 + 任务）时间序列合并与泳道隔离；
 * 2. 日期严格升序排序（同日里程碑优先锚定，次按 id 稳定升序）；
 * 3. 里程碑五状态映射与着色令牌验证（planned / at_risk / achieved / missed / not_started）；
 * 4. 空数据、单项目与无日期节点健壮兜底；
 * 5. fetchGlobalTimelineData 并发请求网络合成（vi.stubGlobal('fetch')，禁 mock api/*）；
 * 6. 周/月/季三档刻度尺与今天锚点百分比计算。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import {
  GLOBAL_MILESTONE_LABEL,
  GLOBAL_MILESTONE_TONE,
  GLOBAL_TASK_LABEL,
  GLOBAL_TASK_TONE,
  compareGlobalTimelineNodes,
  composeGlobalTimelineSeries,
  fetchGlobalTimelineData,
  getProjectColorToken,
  milestoneStatusLabel,
  milestoneToneToken,
  taskStatusLabel,
  taskToneToken,
  type GlobalTimelineNode,
} from '@/lib/next/global-timeline-composer'

function makeProject(id: number, overrides: Partial<Project> = {}): Project {
  return {
    id,
    organizationId: 1,
    name: `项目 ${id}`,
    code: `PRJ-${id}`,
    description: null,
    category: 'it',
    status: 'active',
    priority: 'medium',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    budgetCents: 100000,
    currency: 'CNY',
    progressPercent: 45,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMilestone(
  id: number,
  projectId: number,
  overrides: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    projectId,
    name: `里程碑 ${id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: '2026-09-15',
    autoCalculated: false,
    displayOrder: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function makeTask(id: number, projectId: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId,
    name: `任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'medium',
    taskType: 'task',
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 10,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 30,
    assigneeId: 1,
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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

describe('global-timeline-composer 状态与着色规范', () => {
  test('里程碑五状态映射与 CSS 变量名对齐', () => {
    expect(GLOBAL_MILESTONE_LABEL.planned).toBe('计划中')
    expect(GLOBAL_MILESTONE_LABEL.at_risk).toBe('有风险')
    expect(GLOBAL_MILESTONE_LABEL.achieved).toBe('已达成')
    expect(GLOBAL_MILESTONE_LABEL.missed).toBe('已逾期')
    expect(GLOBAL_MILESTONE_LABEL.not_started).toBe('未开始')

    expect(GLOBAL_MILESTONE_TONE.planned).toBe('--nx-text-secondary')
    expect(milestoneToneToken('planned')).toBe('--nx-text-secondary')
    expect(milestoneToneToken('at_risk')).toBe('--nx-status-warning')
    expect(milestoneToneToken('achieved')).toBe('--nx-status-success')
    expect(milestoneToneToken('missed')).toBe('--nx-status-danger')
    expect(milestoneToneToken('unknown_state')).toBe('--nx-text-muted')
    expect(milestoneStatusLabel('unknown')).toBe('未知')
  })

  test('任务状态映射与 CSS 变量名对齐', () => {
    expect(GLOBAL_TASK_LABEL.in_progress).toBe('进行中')
    expect(GLOBAL_TASK_LABEL.completed).toBe('已完成')
    expect(GLOBAL_TASK_LABEL.blocked).toBe('已阻塞')

    expect(GLOBAL_TASK_TONE.in_progress).toBe('--nx-space-cyan')
    expect(taskToneToken('in_progress')).toBe('--nx-space-cyan')
    expect(taskToneToken('completed')).toBe('--nx-status-success')
    expect(taskToneToken('blocked')).toBe('--nx-status-danger')
    expect(taskStatusLabel('on_hold')).toBe('已挂起')
  })

  test('项目特征色彩微标循环分配（--nx-chart-1 ~ 8）', () => {
    expect(getProjectColorToken(1)).toBe('var(--nx-chart-2)')
    expect(getProjectColorToken(8)).toBe('var(--nx-chart-1)')
    expect(getProjectColorToken(9)).toBe('var(--nx-chart-2)')
  })
})

describe('composeGlobalTimelineSeries 纯函数排序与结构', () => {
  const p1 = makeProject(1, { name: 'Alpha 引擎' })
  const p2 = makeProject(2, { name: 'Beta 云台' })

  test('多项目时间序列合并、泳道隔离与严格升序排序', () => {
    const milestonesMap = {
      1: [
        makeMilestone(101, 1, { name: 'Alpha M1', plannedDate: '2026-09-18' }),
        makeMilestone(102, 1, { name: 'Alpha M2', plannedDate: '2026-09-10' }),
      ],
      2: [makeMilestone(201, 2, { name: 'Beta M1', plannedDate: '2026-09-12' })],
    }
    const tasksMap = {
      1: [makeTask(11, 1, { name: 'Alpha T1', startDate: '2026-09-08', endDate: '2026-09-12' })],
      2: [makeTask(21, 2, { name: 'Beta T1', startDate: '2026-09-15', endDate: '2026-09-25' })],
    }

    const series = composeGlobalTimelineSeries({
      projects: [p1, p2],
      milestonesMap,
      tasksMap,
      today: '2026-09-14',
      scale: 'month',
    })

    expect(series.lanes).toHaveLength(2)
    expect(series.lanes[0]!.projectName).toBe('Alpha 引擎')
    expect(series.lanes[1]!.projectName).toBe('Beta 云台')

    // 验证泳道内节点与全局节点升序
    const allDates = series.allNodes.map((n) => n.date)
    for (let i = 1; i < allDates.length; i++) {
      expect(allDates[i]! >= allDates[i - 1]!).toBe(true)
    }

    // 验证同日排序：里程碑优先于任务
    const nodeA: GlobalTimelineNode = {
      id: 't-1',
      type: 'task',
      projectId: 1,
      projectName: 'P',
      projectColorToken: 'c',
      name: 'T',
      date: '2026-09-10',
      status: 'in_progress',
      statusLabel: '进行中',
      statusTone: '--nx-space-cyan',
      isOverdue: false,
      isAchievedOrCompleted: false,
    }
    const nodeB: GlobalTimelineNode = {
      id: 'm-1',
      type: 'milestone',
      projectId: 1,
      projectName: 'P',
      projectColorToken: 'c',
      name: 'M',
      date: '2026-09-10',
      status: 'planned',
      statusLabel: '计划中',
      statusTone: '--nx-text-secondary',
      isOverdue: false,
      isAchievedOrCompleted: false,
    }
    expect(compareGlobalTimelineNodes(nodeA, nodeB)).toBeGreaterThan(0)
    expect(compareGlobalTimelineNodes(nodeB, nodeA)).toBeLessThan(0)
  })

  test('周/月/季刻度尺生成与今天锚点位置计算', () => {
    const seriesMonth = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [makeMilestone(1, 1, { plannedDate: '2026-09-20' })] },
      tasksMap: { 1: [] },
      today: '2026-09-10',
      scale: 'month',
    })
    expect(seriesMonth.scale).toBe('month')
    expect(seriesMonth.ticks.length).toBeGreaterThan(0)
    expect(seriesMonth.todayPercent).toBeGreaterThanOrEqual(0)
    expect(seriesMonth.todayPercent).toBeLessThanOrEqual(100)

    const seriesWeek = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [] },
      tasksMap: { 1: [] },
      today: '2026-09-10',
      scale: 'week',
    })
    expect(seriesWeek.scale).toBe('week')
    expect(seriesWeek.ticks.length).toBeGreaterThan(0)

    const seriesQuarter = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [] },
      tasksMap: { 1: [] },
      today: '2026-09-10',
      scale: 'quarter',
    })
    expect(seriesQuarter.scale).toBe('quarter')
    expect(seriesQuarter.ticks.some((t) => t.label.includes('Q'))).toBe(true)
  })

  test('空数据与单项目无排期健壮兜底', () => {
    // 零项目
    const emptySeries = composeGlobalTimelineSeries({
      projects: [],
      milestonesMap: {},
      tasksMap: {},
      today: '2026-09-12',
    })
    expect(emptySeries.lanes).toEqual([])
    expect(emptySeries.allNodes).toEqual([])
    expect(emptySeries.totalDays).toBeGreaterThan(0)
    expect(emptySeries.todayPercent).toBeGreaterThan(0)

    // 单项目且无里程碑/任务
    const singleEmpty = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [] },
      tasksMap: { 1: [] },
      today: '2026-09-12',
    })
    expect(singleEmpty.lanes).toHaveLength(1)
    expect(singleEmpty.lanes[0]!.nodes).toEqual([])
    expect(singleEmpty.lanes[0]!.earliestDate).toBeNull()

    // 含有无日期里程碑（plannedDate 为 null）应被跳过不参与排程
    const noDateMilestone = makeMilestone(99, 1, { plannedDate: null })
    const singleWithNull = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [noDateMilestone] },
      tasksMap: { 1: [] },
      today: '2026-09-12',
    })
    expect(singleWithNull.lanes[0]!.nodes).toHaveLength(0)
  })

  test('任务与里程碑逾期状态精准判定', () => {
    const today = '2026-09-15'
    const overdueMilestone = makeMilestone(10, 1, { plannedDate: '2026-09-10', status: 'planned' })
    const achievedMilestone = makeMilestone(11, 1, {
      plannedDate: '2026-09-10',
      status: 'achieved',
    })
    const overdueTask = makeTask(20, 1, { endDate: '2026-09-12', status: 'in_progress' })
    const completedTask = makeTask(21, 1, { endDate: '2026-09-12', status: 'completed' })

    const res = composeGlobalTimelineSeries({
      projects: [p1],
      milestonesMap: { 1: [overdueMilestone, achievedMilestone] },
      tasksMap: { 1: [overdueTask, completedTask] },
      today,
    })

    const mOverdue = res.allNodes.find((n) => n.id === 'm-10')!
    expect(mOverdue.isOverdue).toBe(true)

    const mAchieved = res.allNodes.find((n) => n.id === 'm-11')!
    expect(mAchieved.isOverdue).toBe(false)
    expect(mAchieved.isAchievedOrCompleted).toBe(true)

    const tOverdue = res.allNodes.find((n) => n.id === 't-20')!
    expect(tOverdue.isOverdue).toBe(true)

    const tCompleted = res.allNodes.find((n) => n.id === 't-21')!
    expect(tCompleted.isOverdue).toBe(false)
    expect(tCompleted.isAchievedOrCompleted).toBe(true)
  })
})

describe('fetchGlobalTimelineData 并发请求网络合成 (vi.stubGlobal)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/projects?')) {
        return jsonResponse({
          data: [makeProject(10, { name: '天琴架构' }), makeProject(20, { name: '织女微核' })],
          meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
        })
      }

      if (url.includes('/projects/10/milestones')) {
        return jsonResponse({
          data: [makeMilestone(101, 10, { name: '天琴 M1', plannedDate: '2026-09-18' })],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        })
      }

      if (url.includes('/projects/10/tasks')) {
        return jsonResponse({
          data: [makeTask(1001, 10, { name: '天琴 T1', endDate: '2026-09-14' })],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        })
      }

      if (url.includes('/projects/20/milestones')) {
        return jsonResponse({
          data: [makeMilestone(201, 20, { name: '织女 M1', plannedDate: '2026-09-22' })],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        })
      }

      if (url.includes('/projects/20/tasks')) {
        return jsonResponse({
          data: [makeTask(2001, 20, { name: '织女 T1', endDate: '2026-09-26' })],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        })
      }

      return jsonResponse({ data: [] })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('并发获取各项目排程并纯客户端组装时间序列树', async () => {
    const series = await fetchGlobalTimelineData({
      maxProjects: 10,
      today: '2026-09-12',
      scale: 'month',
    })

    expect(series.lanes).toHaveLength(2)
    expect(series.lanes[0]!.projectName).toBe('天琴架构')
    expect(series.lanes[1]!.projectName).toBe('织女微核')
    expect(series.allNodes).toHaveLength(4)
    expect(series.allNodes[0]!.name).toBe('天琴 T1')
    expect(series.allNodes[3]!.name).toBe('织女 T1')
  })
})
