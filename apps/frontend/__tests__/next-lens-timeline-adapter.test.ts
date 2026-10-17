/**
 * v3-ui-next-remaining-lenses W4 任务 4.2 —— 时间线流向纯函数适配单测。
 *
 * 覆盖（tasks 4.2 / design §11）：
 * 1. 里程碑与任务混合时序升序合流、同日里程碑优先锚定；
 * 2. 里程碑状态 → 发丝信号色令牌判定（planned / at_risk / achieved / missed 四态）；
 * 3. 节点状态语义：达成/完成、逾期推导、Agent 负责人识别、无日期节点剔除；
 * 4. 今天插值索引：跨过去与未来的项目序列中，精确命中 / 日距插值 / 越界钳制。
 */

import { describe, expect, test } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import {
  buildTimelineFlowChain,
  collectStageTaskNodes,
  compareDateKeys,
  computeTodayIndex,
  dateKeyOf,
  daysBetween,
  milestoneStatusLabel,
  milestoneToneToken,
  taskToneToken,
  todayDateKey,
  type TimelineFlowNode,
} from '@/lib/next/lenses-timeline-adapter'

// ---------------------------------------------------------------------------
// Fixtures（相对固定纪元 2026-09-01 构造，杜绝测试随真实时钟漂移）
// ---------------------------------------------------------------------------

const T0 = '2026-09-01'
const D = '2026-09-02'

function shift(key: string, delta: number): string {
  const parts = key.split('-')
  const y = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  const d = Number(parts[2] ?? 0)
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

function makeMilestone(id: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: 7,
    name: `里程碑 ${id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: shift(T0, id * 10),
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
    projectId: 7,
    name: `任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'medium',
    taskType: 'task',
    startDate: shift(T0, id * 3),
    endDate: shift(T0, id * 3 + 4),
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 5,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 40,
    assigneeId: 1,
    assignee: { id: 1, fullName: '张总师', email: 'pm@example.com', initials: 'ZS' },
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function datesOf(nodes: TimelineFlowNode[]): string[] {
  return nodes.map((node) => node.date)
}

describe('日期工具域', () => {
  test('todayDateKey / dateKeyOf 输出规范 YYYY-MM-DD', () => {
    expect(todayDateKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05')
    expect(dateKeyOf(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12-31')
  })

  test('compareDateKeys 日历升序，跨年正确', () => {
    expect(compareDateKeys('2026-01-01', '2025-12-31')).toBe(1)
    expect(compareDateKeys('2026-09-01', '2026-09-02')).toBe(-1)
    expect(compareDateKeys('2026-09-01', '2026-09-01')).toBe(0)
    expect(compareDateKeys('2026-09-01', 'not-a-date')).toBe(-1)
    expect(compareDateKeys('not-a-date', '2026-09-01')).toBe(1)
  })

  test('daysBetween 整天差值（跨月 / 跨年）', () => {
    expect(daysBetween('2026-08-31', '2026-09-05')).toBe(5)
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
    expect(daysBetween('2026-09-05', '2026-09-01')).toBe(-4)
  })
})

describe('buildTimelineFlowChain 合流与排序（tasks 4.1）', () => {
  test('里程碑与任务混合序列按日期严格升序', () => {
    const milestones = [makeMilestone(1), makeMilestone(2)] // 9-11 / 9-21
    const tasks = [
      makeTask(1, { endDate: shift(T0, 4), startDate: T0 }), // 9-05
      makeTask(2, { endDate: shift(T0, 16), startDate: shift(T0, 12) }), // 9-17
      makeTask(3, { endDate: shift(T0, 30), startDate: shift(T0, 26) }), // 10-01
    ]
    const { chain, totalNodes } = buildTimelineFlowChain(milestones, tasks, D)
    expect(chain).toHaveLength(5)
    expect(totalNodes).toBe(5)
    const dates = datesOf(chain)
    for (let i = 1; i < dates.length; i += 1) {
      expect(compareDateKeys(dates[i - 1]!, dates[i]!)).toBeLessThanOrEqual(0)
    }
    // 时间升序：任务1(9-05) < M1(9-11) < 任务2(9-17) < M2(9-21) < 任务3(10-01)
    expect(chain.map((n) => n.id)).toEqual(['t-1', 'm-1', 't-2', 'm-2', 't-3'])
  })

  test('同一日期下里程碑优先锚定，其后任务按 id 稳定升序', () => {
    const milestones = [makeMilestone(5, { plannedDate: '2026-09-10' })]
    const tasks = [
      makeTask(9, { endDate: '2026-09-10', startDate: '2026-09-01' }),
      makeTask(2, { endDate: '2026-09-10', startDate: '2026-09-01' }),
    ]
    const { chain } = buildTimelineFlowChain(milestones, tasks, D)
    expect(chain.map((n) => n.id)).toEqual(['m-5', 't-2', 't-9'])
    expect(chain[0]?.type).toBe('milestone')
  })

  test('任务以排程截止日锚定；缺截止日时兜底起始日；双无日期不参与流向', () => {
    const tasks = [
      makeTask(1, { startDate: '2026-09-03', endDate: '2026-09-08' }),
      makeTask(2, { startDate: '2026-09-20', endDate: null }),
      makeTask(3, { startDate: null, endDate: null }),
      makeTask(4, { startDate: null, endDate: '2026-09-25' }),
    ]
    const { chain } = buildTimelineFlowChain([], tasks, D)
    expect(chain.map((n) => n.id)).toEqual(['t-1', 't-2', 't-4'])
    expect(chain[1]?.date).toBe('2026-09-20')
    expect(chain[2]?.date).toBe('2026-09-25')
  })

  test('未设定计划日期的里程碑不进入流向链表', () => {
    const milestones = [
      makeMilestone(1, { plannedDate: '2026-09-11' }),
      makeMilestone(2, { plannedDate: null }),
    ]
    const { chain } = buildTimelineFlowChain(milestones, [], D)
    expect(chain.map((n) => n.id)).toEqual(['m-1'])
    expect(chain[0]?.rawMilestone?.id).toBe(1)
  })

  test('全空输入返回空链表与零锚点', () => {
    const { chain, todayIndex, totalNodes } = buildTimelineFlowChain([], [], D)
    expect(chain).toEqual([])
    expect(todayIndex).toBe(0)
    expect(totalNodes).toBe(0)
  })
})

describe('节点状态语义推导', () => {
  test('里程碑达成/逾期判定取自展示态', () => {
    const milestones = [
      makeMilestone(1, { plannedDate: '2026-08-01', status: 'achieved' }),
      makeMilestone(2, { plannedDate: '2026-08-10', status: 'missed' }),
      makeMilestone(3, { plannedDate: '2026-10-01', status: 'at_risk' }),
      makeMilestone(4, { plannedDate: '2026-10-10', status: 'planned' }),
    ]
    const { chain } = buildTimelineFlowChain(milestones, [], '2026-09-01')
    expect(chain[0]).toMatchObject({
      id: 'm-1',
      type: 'milestone',
      isAchievedOrCompleted: true,
      isOverdue: false,
    })
    expect(chain[1]).toMatchObject({ id: 'm-2', isAchievedOrCompleted: false, isOverdue: true })
    expect(chain[2]).toMatchObject({ id: 'm-3', isOverdue: false })
    expect(chain[3]).toMatchObject({ id: 'm-4', isAchievedOrCompleted: false })
  })

  test('任务逾期：截止日早于今天且未完结；completed/cancelled 豁免', () => {
    const today = '2026-09-10'
    const tasks = [
      makeTask(1, { endDate: '2026-09-01', status: 'in_progress' }), // 逾期
      makeTask(2, { endDate: '2026-09-01', status: 'completed' }), // 完结豁免
      makeTask(3, { endDate: '2026-09-01', status: 'cancelled' }), // 取消豁免
      makeTask(4, { endDate: '2026-09-12', status: 'in_progress' }), // 未来
      makeTask(5, { endDate: null, startDate: '2026-09-01' }), // 无截止日
      makeTask(6, { endDate: '2026-09-10', status: 'blocked' }), // 当天到期不算逾期
    ]
    const { chain } = buildTimelineFlowChain([], tasks, today)
    const byId = new Map(chain.map((n) => [n.id, n]))
    expect(byId.get('t-1')).toMatchObject({ isOverdue: true, isAchievedOrCompleted: false })
    expect(byId.get('t-2')).toMatchObject({ isOverdue: false, isAchievedOrCompleted: true })
    expect(byId.get('t-3')).toMatchObject({ isOverdue: false, isAchievedOrCompleted: false })
    expect(byId.get('t-4')).toMatchObject({ isOverdue: false })
    expect(byId.get('t-5')).toMatchObject({ isOverdue: false })
    expect(byId.get('t-6')).toMatchObject({ isOverdue: false })
  })

  test('负责人：人类 fullName 与 Agent 专属识别', () => {
    const tasks = [
      makeTask(1),
      makeTask(2, {
        assigneeId: 11,
        assigneeType: 'agent',
        agentAssignee: { id: 11, name: '排程 Agent', initials: 'AG', model: 'gpt-4' },
      }),
    ]
    const { chain } = buildTimelineFlowChain([], tasks, D)
    expect(chain[0]).toMatchObject({
      assigneeName: '张总师',
      progress: 40,
      durationDays: 5,
    })
    expect(chain[0]?.isAgent).toBeUndefined()
    expect(chain[1]).toMatchObject({ assigneeName: '排程 Agent', isAgent: true })
  })
})

describe('里程碑状态信号色判定（tasks 4.2）', () => {
  test('四种生命周期状态映射到对应发丝令牌', () => {
    expect(milestoneToneToken('planned')).toBe('--nx-text-secondary')
    expect(milestoneToneToken('at_risk')).toBe('--nx-status-warning')
    expect(milestoneToneToken('achieved')).toBe('--nx-status-success')
    expect(milestoneToneToken('missed')).toBe('--nx-status-danger')
    expect(milestoneToneToken('not_started')).toBe('--nx-text-muted')
    expect(milestoneToneToken('unknown')).toBe('--nx-text-muted')
  })

  test('里程碑状态中文文案', () => {
    expect(milestoneStatusLabel('planned')).toBe('计划中')
    expect(milestoneStatusLabel('at_risk')).toBe('有风险')
    expect(milestoneStatusLabel('achieved')).toBe('已达成')
    expect(milestoneStatusLabel('missed')).toBe('已逾期')
  })

  test('任务状态信号色令牌全量映射', () => {
    expect(taskToneToken('completed')).toBe('--nx-status-success')
    expect(taskToneToken('in_progress')).toBe('--nx-space-cyan')
    expect(taskToneToken('blocked')).toBe('--nx-status-danger')
    expect(taskToneToken('on_hold')).toBe('--nx-status-warning')
    expect(taskToneToken('not_started')).toBe('--nx-text-muted')
    expect(taskToneToken('cancelled')).toBe('--nx-text-muted')
    expect(taskToneToken('bogus')).toBe('--nx-text-muted')
  })
})

describe('computeTodayIndex 今天插值索引（tasks 4.2）', () => {
  // 序列：m1 9-01 | t2 9-06 | m3 9-11 | t4 9-16 | m5 9-21
  function sampleChain(): TimelineFlowNode[] {
    const milestones = [
      makeMilestone(1, { plannedDate: '2026-09-01', status: 'achieved' }),
      makeMilestone(3, { plannedDate: '2026-09-11', status: 'planned' }),
      makeMilestone(5, { plannedDate: '2026-09-21', status: 'planned' }),
    ]
    const tasks = [
      makeTask(2, { endDate: '2026-09-06', status: 'completed' }),
      makeTask(4, { endDate: '2026-09-16', status: 'in_progress' }),
    ]
    return buildTimelineFlowChain(milestones, tasks, '2026-09-01').chain
  }

  test('精确命中锚点日期返回整数索引', () => {
    const chain = sampleChain()
    expect(computeTodayIndex(chain, '2026-09-01')).toBe(0)
    expect(computeTodayIndex(chain, '2026-09-06')).toBe(1)
    expect(computeTodayIndex(chain, '2026-09-11')).toBe(2)
    expect(computeTodayIndex(chain, '2026-09-21')).toBe(4)
  })

  test('介于两锚点之间按日距线性插值', () => {
    const chain = sampleChain()
    // 9-06 与 9-11 之间：第 2 天 / 共 5 天 → 1 + 2/5
    expect(computeTodayIndex(chain, '2026-09-08')).toBeCloseTo(1.4, 6)
    // 9-16 与 9-21 之间：第 3 天 / 共 5 天 → 3 + 3/5
    expect(computeTodayIndex(chain, '2026-09-19')).toBeCloseTo(3.6, 6)
    // 首个锚点前一日与锚点本身无跨度 → 钉在起点
    expect(computeTodayIndex(chain, '2026-08-20')).toBe(0)
  })

  test('今天晚于全部锚点钉在末端索引', () => {
    const chain = sampleChain()
    expect(computeTodayIndex(chain, '2026-12-31')).toBe(chain.length - 1)
    expect(computeTodayIndex(chain, '2026-09-22')).toBe(chain.length - 1)
  })

  test('空链表与单锚点链表的边界', () => {
    expect(computeTodayIndex([], '2026-09-01')).toBe(0)
    const single = [makeMilestone(1, { plannedDate: '2026-09-10' })]
    const { chain } = buildTimelineFlowChain(single, [], D)
    expect(computeTodayIndex(chain, '2026-09-10')).toBe(0)
    expect(computeTodayIndex(chain, '2026-09-11')).toBe(0)
    expect(computeTodayIndex(chain, '2026-09-01')).toBe(0)
  })

  test('同一日期多锚点下今天命中该日期段的起始位', () => {
    const milestones = [makeMilestone(1, { plannedDate: '2026-09-10' })]
    const tasks = [
      makeTask(2, { endDate: '2026-09-10', startDate: '2026-09-01' }),
      makeTask(3, { endDate: '2026-09-10', startDate: '2026-09-01' }),
    ]
    const { chain } = buildTimelineFlowChain(milestones, tasks, D)
    expect(computeTodayIndex(chain, '2026-09-10')).toBe(0)
    // 早于首个锚点 → 钉在起点（与「项目尚未开始」语义一致）
    expect(computeTodayIndex(chain, '2026-09-09')).toBe(0)
  })
})

describe('collectStageTaskNodes 相邻里程碑阶段任务聚类', () => {
  test('抽取两里程碑之间的同阶段任务流', () => {
    const milestones = [
      makeMilestone(1, { plannedDate: '2026-09-01' }),
      makeMilestone(2, { plannedDate: '2026-09-21' }),
      makeMilestone(3, { plannedDate: '2026-10-10' }),
    ]
    const tasks = [
      makeTask(1, { endDate: '2026-09-06' }),
      makeTask(2, { endDate: '2026-09-16' }),
      makeTask(3, { endDate: '2026-10-02' }),
      makeTask(4, { endDate: '2026-10-20' }),
    ]
    const { chain } = buildTimelineFlowChain(milestones, tasks, D)
    const idx = new Map(chain.map((node, i) => [node.id, i]))
    expect(collectStageTaskNodes(chain, idx.get('m-1')!).map((n) => n.id)).toEqual(['t-1', 't-2'])
    expect(collectStageTaskNodes(chain, idx.get('m-2')!).map((n) => n.id)).toEqual(['t-3'])
    expect(collectStageTaskNodes(chain, idx.get('m-3')!).map((n) => n.id)).toEqual(['t-4'])
  })

  test('里程碑本身不进入其阶段任务流；越界索引返回空数组', () => {
    const milestones = [makeMilestone(1, { plannedDate: '2026-09-01' })]
    const { chain } = buildTimelineFlowChain(milestones, [], D)
    expect(collectStageTaskNodes(chain, 0)).toEqual([])
    expect(collectStageTaskNodes(chain, -1)).toEqual([])
    expect(collectStageTaskNodes(chain, 5)).toEqual([])
    expect(collectStageTaskNodes([], 0)).toEqual([])
  })
})
