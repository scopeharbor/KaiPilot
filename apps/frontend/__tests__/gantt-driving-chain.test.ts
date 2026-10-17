import { describe, expect, it } from 'vitest'
import { computeDrivingChain } from '@/lib/gantt/driving-chain'
import type { GanttModel, GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

function task(
  id: number,
  startDay: number,
  durationDays: number,
  kind: GanttRenderTask['kind'] = 'task',
) {
  return {
    id,
    name: `T${id}`,
    kind,
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
    depth: 0,
  } as unknown as GanttRenderTask
}

function dep(
  id: number,
  predecessorId: number,
  successorId: number,
  type: GanttRenderDependency['type'] = 'fs',
  lagDays = 0,
) {
  return { id, predecessorId, successorId, type, lagDays } as GanttRenderDependency
}

function model(tasks: GanttRenderTask[], dependencies: GanttRenderDependency[]): GanttModel {
  return {
    tasks,
    dependencies,
    milestones: [],
    timeRange: { startDay: 0, endDay: 100 },
    epochMs: 0,
  }
}

describe('computeDrivingChain', () => {
  it('计划留空档时仍能追出决定完工日的整条依赖链（严格 CPM 只剩链尾）', () => {
    // 1 → 2 → 4，3 → 4；2 结束于 day 15，3 结束于 day 12，4 在 day 20 开工（留了空档）
    const m = model(
      [task(1, 0, 5), task(2, 8, 7), task(3, 2, 10), task(4, 20, 5)],
      [dep(10, 1, 2), dep(11, 2, 4), dep(12, 3, 4)],
    )
    const chain = computeDrivingChain(m)
    expect([...chain.taskIds].sort()).toEqual([1, 2, 4])
    expect([...chain.depIds].sort()).toEqual([10, 11])
    expect(chain.breakTaskIds).toEqual([])
  })

  it('链起点晚于项目开工且没有前置：标为依赖断点', () => {
    // 9 → 10 在后期，与前期任务 1 没有依赖相连
    const m = model([task(1, 0, 20), task(9, 30, 5), task(10, 35, 5)], [dep(1, 9, 10)])
    const chain = computeDrivingChain(m)
    expect([...chain.taskIds].sort()).toEqual([10, 9])
    expect(chain.breakTaskIds).toEqual([9])
  })

  it('并列的前置都算在链上；孤立的晚完成任务不作为链终点', () => {
    const m = model(
      [task(1, 0, 5), task(2, 0, 5), task(3, 5, 5), task(9, 0, 40)],
      [dep(1, 1, 3), dep(2, 2, 3)],
    )
    const chain = computeDrivingChain(m)
    expect([...chain.taskIds].sort()).toEqual([1, 2, 3])
    expect(chain.taskIds.has(9)).toBe(false)
  })

  it('SS/滞后按约束日比较；汇总行与无依赖模型返回空链', () => {
    const m = model(
      [task(1, 0, 10), task(2, 0, 3), task(3, 6, 4)],
      [dep(1, 1, 3, 'ss', 6), dep(2, 2, 3, 'fs', 0)],
    )
    expect([...computeDrivingChain(m).depIds]).toEqual([1])
    expect(computeDrivingChain(model([task(1, 0, 3, 'summary')], [])).taskIds.size).toBe(0)
  })
})
