/**
 * What-if 会话工具测试 —— buildGanttBaseSnapshot
 */

import { describe, it, expect } from 'vitest'
import { buildGanttBaseSnapshot } from '@/lib/gantt/what-if-session'
import type { GanttRenderTask, GanttRenderDependency } from '@/lib/gantt/types'

function makeTask(id: number, startDay = 0, durationDays = 5): GanttRenderTask {
  return {
    id,
    name: `T${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
  }
}

describe('buildGanttBaseSnapshot', () => {
  it('tasks/deps/calendar 一致时 hash 相同', () => {
    const tasks = [makeTask(1), makeTask(2)]
    const deps: readonly GanttRenderDependency[] = [
      { id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 },
    ]
    const a = buildGanttBaseSnapshot(tasks, deps, null, 'v1')
    const b = buildGanttBaseSnapshot(tasks, deps, null, 'v1')
    expect(a.inputHash).toBe(b.inputHash)
  })

  it('tasks 不同时 hash 不同', () => {
    const a = buildGanttBaseSnapshot([makeTask(1)], [], null, 'v1')
    const b = buildGanttBaseSnapshot([makeTask(1, 99)], [], null, 'v1')
    expect(a.inputHash).not.toBe(b.inputHash)
  })

  it('依赖不同时 hash 不同', () => {
    const tasks = [makeTask(1), makeTask(2)]
    const a = buildGanttBaseSnapshot(
      tasks,
      [{ id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 }],
      null,
      'v1',
    )
    const b = buildGanttBaseSnapshot(
      tasks,
      [{ id: 1, predecessorId: 2, successorId: 1, type: 'fs', lagDays: 0 }],
      null,
      'v1',
    )
    expect(a.inputHash).not.toBe(b.inputHash)
  })

  it('calendar 不同时 hash 不同', () => {
    const tasks = [makeTask(1)]
    const a = buildGanttBaseSnapshot(tasks, [], null, 'v1')
    const b = buildGanttBaseSnapshot(
      tasks,
      [],
      { workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
      'v1',
    )
    expect(a.inputHash).not.toBe(b.inputHash)
  })

  it('serverRevision 不影响 hash', () => {
    const tasks = [makeTask(1)]
    const a = buildGanttBaseSnapshot(tasks, [], null, 'v1')
    const b = buildGanttBaseSnapshot(tasks, [], null, 'v2')
    expect(a.inputHash).toBe(b.inputHash)
  })

  it('非排程字段变化不影响 hash', () => {
    const taskA = makeTask(1)
    const taskB = { ...makeTask(1), progress: 0.5, status: 'in_progress' as const }
    const a = buildGanttBaseSnapshot([taskA], [], null, 'v1')
    const b = buildGanttBaseSnapshot([taskB], [], null, 'v1')
    expect(a.inputHash).toBe(b.inputHash)
  })
})
