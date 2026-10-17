import { describe, expect, it } from 'vitest'
import { applySchedulePreviewToModel, buildGanttModelFromApi } from '@/lib/gantt/model-from-api'
import type { Task } from '@/lib/api/tasks'
import type { TaskDependency } from '@/lib/api/dependencies'
import type { Milestone } from '@/lib/api/milestones'

function mkTask(p: Partial<Task> & { id: number }): Task {
  return {
    projectId: 1,
    name: `T${p.id}`,
    description: null,
    status: 'not_started',
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
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    ...p,
  }
}

function mkDep(id: number, predecessorId: number, successorId: number): TaskDependency {
  const stub = (i: number) => ({
    id: i,
    name: `T${i}`,
    status: 'not_started' as const,
    startDate: null,
    endDate: null,
  })
  return {
    id,
    predecessorId,
    successorId,
    type: 'fs',
    lagDays: 0,
    predecessor: stub(predecessorId),
    successor: stub(successorId),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  }
}

function mkMilestone(partial: Partial<Milestone> & { id: number }): Milestone {
  return {
    projectId: 1,
    name: `M${partial.id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: '2026-03-18',
    autoCalculated: false,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    ...partial,
  }
}

describe('buildGanttModelFromApi —— 真实数据组装（task 2.1/2.5）', () => {
  const tasks: Task[] = [
    mkTask({ id: 1, startDate: '2026-03-10' }), // 有子 → summary，无 end/duration → 1 天
    mkTask({
      id: 2,
      parentTaskId: 1,
      startDate: '2026-03-12',
      endDate: '2026-03-15',
      progressPercent: 60,
    }),
    mkTask({ id: 3, taskType: 'milestone', startDate: '2026-03-20' }),
    mkTask({ id: 4, durationDays: 3 }), // 无日期 → startDay 0
  ]
  const deps: TaskDependency[] = [mkDep(1, 2, 3), mkDep(2, 2, 999)] // 后者引用不存在任务

  const model = buildGanttModelFromApi(tasks, deps)
  const byId = new Map(model.tasks.map((t) => [t.id, t]))

  it('epoch = 最早起始日；天偏移相对该 epoch', () => {
    expect(model.epochMs).toBe(Date.parse('2026-03-10T00:00:00Z'))
    expect(byId.get(1)?.startDay).toBe(0)
    expect(byId.get(2)?.startDay).toBe(2) // 03-12 距 03-10 = 2 天
    expect(byId.get(3)?.startDay).toBe(10) // 03-20
  })

  it('taskType/子节点 → kind：milestone / summary / task', () => {
    expect(byId.get(1)?.kind).toBe('summary') // 有子节点
    expect(byId.get(2)?.kind).toBe('task')
    expect(byId.get(3)?.kind).toBe('milestone')
    expect(byId.get(4)?.kind).toBe('task')
  })

  it('工期：里程碑 0、显式 durationDays、日期跨度回退', () => {
    expect(byId.get(3)?.durationDays).toBe(0) // 里程碑
    expect(byId.get(4)?.durationDays).toBe(3) // 显式
    expect(byId.get(2)?.durationDays).toBe(4) // 03-12..03-15 含端点
    expect(byId.get(1)?.durationDays).toBe(1) // 无 end/duration 回退
  })

  it('进度归一到 0..1；层级由 parentTaskId 派生', () => {
    expect(byId.get(2)?.progress).toBeCloseTo(0.6)
    expect(byId.get(1)?.depth).toBe(0)
    expect(byId.get(2)?.depth).toBe(1)
  })

  it('依赖只保留两端都存在的；里程碑派生', () => {
    expect(model.dependencies).toHaveLength(1)
    expect(model.dependencies[0]).toMatchObject({ predecessorId: 2, successorId: 3, type: 'fs' })
    expect(model.milestones).toHaveLength(1)
    expect(model.milestones[0]).toMatchObject({ taskId: 3, status: 'not_started' })
  })

  it('有真实里程碑时整体切换真实源，不混用任务派生里程碑', () => {
    const real = [
      mkMilestone({ id: 9, name: '真实评审点', plannedDate: '2026-03-08', status: 'at_risk' }),
    ]
    const withReal = buildGanttModelFromApi(tasks, deps, null, real)

    expect(withReal.epochMs).toBe(Date.parse('2026-03-08T00:00:00Z'))
    expect(withReal.milestones).toEqual([
      {
        id: 9,
        taskId: -10,
        day: 0,
        name: '真实评审点',
        status: 'at_risk',
      },
    ])
    expect(withReal.tasks.filter((task) => task.kind === 'milestone')).toHaveLength(1)
    expect(withReal.tasks.find((task) => task.id === -10)).toMatchObject({
      milestoneId: 9,
      name: '真实评审点',
      startDay: 0,
    })
    expect(withReal.tasks.some((task) => task.id === 3)).toBe(false)
  })

  it('timeRange.endDay = 最大结束天', () => {
    expect(model.timeRange.endDay).toBe(10) // 里程碑 3 在第 10 天
  })

  it('空输入不崩，回退固定 epoch', () => {
    const empty = buildGanttModelFromApi([], [])
    expect(empty.tasks).toHaveLength(0)
    expect(empty.dependencies).toHaveLength(0)
    expect(empty.epochMs).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })
})

describe('buildGanttModelFromApi —— CPM 回填（T021 task 4.3）', () => {
  it('单链 A→B→C 全部回填 isCritical，关键依赖标记', () => {
    // 2026-03-10(周二) .. 03-11(周三) .. 03-12(周四)，默认 Mon-Fri 工作日
    const tasks: Task[] = [
      mkTask({ id: 1, startDate: '2026-03-10', endDate: '2026-03-10' }),
      mkTask({ id: 2, startDate: '2026-03-11', endDate: '2026-03-11' }),
      mkTask({ id: 3, startDate: '2026-03-12', endDate: '2026-03-12' }),
    ]
    const deps: TaskDependency[] = [mkDep(1, 1, 2), mkDep(2, 2, 3)]
    const model = buildGanttModelFromApi(tasks, deps, { workdays: [1, 2, 3, 4, 5] })
    const byId = new Map(model.tasks.map((t) => [t.id, t]))
    expect(byId.get(1)?.isCritical).toBe(true)
    expect(byId.get(2)?.isCritical).toBe(true)
    expect(byId.get(3)?.isCritical).toBe(true)
    expect(byId.get(1)?.totalFloat).toBe(0)
    expect(model.dependencies[0]?.isCritical).toBe(true)
    expect(model.dependencies[1]?.isCritical).toBe(true)
  })

  it('汇总任务不参与 CPM（isCritical=false），其子任务正常参与', () => {
    // 任务 1 有子节点 → summary；任务 2、3 是子任务，2→3 单链关键
    const tasks: Task[] = [
      mkTask({ id: 1, startDate: '2026-03-10', endDate: '2026-03-12' }),
      mkTask({ id: 2, parentTaskId: 1, startDate: '2026-03-10', endDate: '2026-03-10' }),
      mkTask({ id: 3, parentTaskId: 1, startDate: '2026-03-11', endDate: '2026-03-11' }),
    ]
    const deps: TaskDependency[] = [mkDep(1, 2, 3)]
    const model = buildGanttModelFromApi(tasks, deps, { workdays: [1, 2, 3, 4, 5] })
    const byId = new Map(model.tasks.map((t) => [t.id, t]))
    expect(byId.get(1)?.kind).toBe('summary')
    expect(byId.get(1)?.isCritical).toBe(false)
    expect(byId.get(2)?.isCritical).toBe(true)
    expect(byId.get(3)?.isCritical).toBe(true)
  })

  it('并行分支：长路径关键，短路径任务 totalFloat>0', () => {
    // A→B→D（长）与 A→C→D（短），D 终点
    const tasks: Task[] = [
      mkTask({ id: 1, startDate: '2026-03-10', endDate: '2026-03-10' }), // A 周二
      mkTask({ id: 2, startDate: '2026-03-11', endDate: '2026-03-12' }), // B 周三..周四
      mkTask({ id: 3, startDate: '2026-03-11', endDate: '2026-03-11' }), // C 周三
      mkTask({ id: 4, startDate: '2026-03-13', endDate: '2026-03-13' }), // D 周五
    ]
    const deps: TaskDependency[] = [mkDep(1, 1, 2), mkDep(2, 1, 3), mkDep(3, 2, 4), mkDep(4, 3, 4)]
    const model = buildGanttModelFromApi(tasks, deps, { workdays: [1, 2, 3, 4, 5] })
    const byId = new Map(model.tasks.map((t) => [t.id, t]))
    expect(byId.get(1)?.isCritical).toBe(true) // A
    expect(byId.get(2)?.isCritical).toBe(true) // B（长路径）
    expect(byId.get(3)?.isCritical).toBe(false) // C（短路径有浮动）
    expect(byId.get(3)?.totalFloat ?? 0).toBeGreaterThan(0)
    expect(byId.get(4)?.isCritical).toBe(true) // D
  })
})

describe('preview→commit CPM 一致性（T021 task 5.2）', () => {
  it('同一纯函数 + 同一日历下，preview 与 commit 关键路径口径一致', () => {
    // 基线：A→B→C 单链，A 在 03-10
    const baseTasks: Task[] = [
      mkTask({ id: 1, startDate: '2026-03-10', endDate: '2026-03-10' }),
      mkTask({ id: 2, startDate: '2026-03-11', endDate: '2026-03-11' }),
      mkTask({ id: 3, startDate: '2026-03-12', endDate: '2026-03-12' }),
    ]
    const deps: TaskDependency[] = [mkDep(1, 1, 2), mkDep(2, 2, 3)]
    const calendar = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    const base = buildGanttModelFromApi(baseTasks, deps, calendar)

    // preview：把 A 移到 03-12（周四），B/C 随 FS 顺延到 03-13/03-14
    const preview = applySchedulePreviewToModel(
      base,
      [
        { taskId: 1, after: { startDate: '2026-03-12', endDate: '2026-03-12' } },
        { taskId: 2, after: { startDate: '2026-03-13', endDate: '2026-03-13' } },
        { taskId: 3, after: { startDate: '2026-03-14', endDate: '2026-03-14' } },
      ],
      calendar,
    )

    // commit：用落库后的日期重建模型
    const committedTasks: Task[] = [
      mkTask({ id: 1, startDate: '2026-03-12', endDate: '2026-03-12' }),
      mkTask({ id: 2, startDate: '2026-03-13', endDate: '2026-03-13' }),
      mkTask({ id: 3, startDate: '2026-03-14', endDate: '2026-03-14' }),
    ]
    const committed = buildGanttModelFromApi(committedTasks, deps, calendar)

    const previewById = new Map(preview.tasks.map((t) => [t.id, t]))
    const committedById = new Map(committed.tasks.map((t) => [t.id, t]))
    for (const id of [1, 2, 3]) {
      expect(previewById.get(id)?.isCritical).toBe(committedById.get(id)?.isCritical)
      expect(previewById.get(id)?.totalFloat).toBe(committedById.get(id)?.totalFloat)
    }
    // 单链全关键
    for (const id of [1, 2, 3]) {
      expect(committedById.get(id)?.isCritical).toBe(true)
    }
  })
})
