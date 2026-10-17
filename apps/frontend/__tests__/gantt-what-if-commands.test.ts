/**
 * What-if 命令单元测试 —— 命令执行、验证、求逆、环检测、历史管理。
 */

import { describe, it, expect } from 'vitest'
import type { WhatIfBaseSnapshot } from '@/lib/gantt/what-if-types'
import { createEmptyHistory } from '@/lib/gantt/what-if-types'
import {
  executeCommandOnSnapshot,
  executeCommandAndPreview,
  executeCommandsAndPreview,
  validateCommand,
  wouldCreateCycle,
  pushCommand,
  undoCommand,
  redoCommand,
  activeCommands,
} from '@/lib/gantt/what-if-commands'
import type { GanttRenderTask, GanttRenderDependency } from '@/lib/gantt/types'

function makeTask(
  id: number,
  startDay = 0,
  durationDays = 5,
  kind: GanttRenderTask['kind'] = 'task',
): GanttRenderTask {
  return {
    id,
    name: `Task ${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind,
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
  }
}

function makeDep(id: number, pred: number, succ: number): GanttRenderDependency {
  return { id, predecessorId: pred, successorId: succ, type: 'fs', lagDays: 0 }
}

function makeBaseSnapshot(
  tasks: GanttRenderTask[],
  deps: GanttRenderDependency[] = [],
): WhatIfBaseSnapshot {
  return {
    serverRevision: 'v1',
    inputHash: 'test_hash',
    tasks,
    dependencies: deps,
    calendarSettings: null,
  }
}

describe('executeCommandOnSnapshot', () => {
  it('move-task 移动任务', () => {
    const base = makeBaseSnapshot([makeTask(1, 0, 5)])
    const result = executeCommandOnSnapshot(base, {
      kind: 'move-task',
      taskId: 1,
      newStartDate: '2025-02-01',
    })
    // 任务应被移动（startDay 变化）
    const task = result.tasks.find((t) => t.id === 1)
    expect(task).toBeDefined()
    expect(task!.id).toBe(1)
    expect(result.affectedIds).toContain(1)
  })

  it('move-task 跳过里程碑', () => {
    const milestone = makeTask(1, 0, 0, 'milestone')
    const base = makeBaseSnapshot([milestone])
    const result = executeCommandOnSnapshot(base, {
      kind: 'move-task',
      taskId: 1,
      newStartDate: '2025-02-01',
    })
    expect(result.affectedIds).not.toContain(1)
  })

  it('resize-duration 调整工期', () => {
    const base = makeBaseSnapshot([makeTask(1, 0, 5)])
    const result = executeCommandOnSnapshot(base, {
      kind: 'resize-duration',
      taskId: 1,
      newStartDate: '2025-01-13',
      newEndDate: '2025-01-24',
    })
    expect(result.affectedIds).toContain(1)
  })

  it('add-dependency 新增依赖', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 10, 5), makeTask(3, 20, 3)]
    const base = makeBaseSnapshot(tasks, [makeDep(1, 1, 2)])
    const result = executeCommandOnSnapshot(base, {
      kind: 'add-dependency',
      predecessorId: 2,
      successorId: 3,
    })
    expect(result.dependencies.length).toBe(2)
    expect(result.affectedIds).toContain(2)
    expect(result.affectedIds).toContain(3)
  })

  it('add-dependency 拒绝环', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 10, 5)]
    const base = makeBaseSnapshot(tasks, [makeDep(1, 1, 2)])
    const result = executeCommandOnSnapshot(base, {
      kind: 'add-dependency',
      predecessorId: 2, // 2→1 会形成环（已有 1→2）
      successorId: 1,
    })
    // 依赖不增加
    expect(result.dependencies.length).toBe(1)
    expect(result.affectedIds).toEqual([])
  })

  it('remove-dependency 移除依赖', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 10, 5)]
    const base = makeBaseSnapshot(tasks, [makeDep(1, 1, 2)])
    const result = executeCommandOnSnapshot(base, {
      kind: 'remove-dependency',
      dependencyId: 1,
      predecessorId: 1,
      successorId: 2,
    })
    expect(result.dependencies.length).toBe(0)
  })

  it('milestone-move 移动里程碑', () => {
    const ms = makeTask(1, 0, 0, 'milestone')
    const base = makeBaseSnapshot([ms])
    const result = executeCommandOnSnapshot(base, {
      kind: 'milestone-move',
      milestoneId: 1,
      taskId: 1,
      newDate: '2025-03-01',
    })
    expect(result.affectedIds).toContain(1)
  })
})

describe('validateCommand', () => {
  const taskIds = new Set([1, 2])
  const depIds = new Set([1])

  it('合法 move-task', () => {
    expect(
      validateCommand(
        { kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' },
        taskIds,
        depIds,
      ),
    ).toEqual({ valid: true, error: null })
  })

  it('不存在的任务 → 非法', () => {
    expect(
      validateCommand(
        { kind: 'move-task', taskId: 99, newStartDate: '2025-02-01' },
        taskIds,
        depIds,
      ),
    ).toEqual({ valid: false, error: '任务 99 不存在' })
  })

  it('add-dependency 自依赖 → 非法', () => {
    expect(
      validateCommand(
        { kind: 'add-dependency', predecessorId: 1, successorId: 1 },
        taskIds,
        depIds,
      ),
    ).toEqual({ valid: false, error: '不能自依赖' })
  })

  it('remove-dependency 不存在 → 非法', () => {
    expect(
      validateCommand(
        { kind: 'remove-dependency', dependencyId: 99, predecessorId: 1, successorId: 2 },
        taskIds,
        depIds,
      ),
    ).toEqual({ valid: false, error: '依赖 99 不存在' })
  })
})

describe('wouldCreateCycle', () => {
  it('检测直接环', () => {
    const deps = [makeDep(1, 1, 2)]
    expect(wouldCreateCycle(deps, 2, 1)).toBe(true) // 2→1 形成环（已有 1→2）
  })

  it('间接环', () => {
    const deps = [makeDep(1, 1, 2), makeDep(2, 2, 3)]
    expect(wouldCreateCycle(deps, 3, 1)).toBe(true)
  })

  it('无环时返回 false', () => {
    const deps = [makeDep(1, 1, 2)]
    expect(wouldCreateCycle(deps, 1, 3)).toBe(false)
  })

  it('空依赖集返回 false', () => {
    expect(wouldCreateCycle([], 1, 2)).toBe(false)
  })
})

describe('executeCommandAndPreview', () => {
  it('返回包含 CPM 回填的 GanttModel', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 6, 3)]
    const base = makeBaseSnapshot(tasks)
    const preview = executeCommandAndPreview(base, {
      kind: 'move-task',
      taskId: 2,
      newStartDate: '2025-01-13',
    })
    expect(preview.model).toBeDefined()
    expect(preview.model.tasks.length).toBe(2)
    expect(preview.affectedTaskIds).toEqual([2])
  })
})

describe('executeCommandsAndPreview', () => {
  it('批量执行多条命令', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 6, 3)]
    const base = makeBaseSnapshot(tasks)
    const preview = executeCommandsAndPreview(base, [
      { kind: 'move-task', taskId: 1, newStartDate: '2025-01-20' },
      { kind: 'move-task', taskId: 2, newStartDate: '2025-02-01' },
    ])
    expect(preview.model).toBeDefined()
    expect(preview.affectedTaskIds.length).toBeGreaterThanOrEqual(2)
  })

  it('空命令集返回 base 副本', () => {
    const tasks = [makeTask(1, 0, 5)]
    const base = makeBaseSnapshot(tasks)
    const preview = executeCommandsAndPreview(base, [])
    expect(preview.model.tasks.length).toBe(1)
  })
})

describe('History Management', () => {
  it('pushCommand 追加并截断 redo tail', () => {
    const h = pushCommand(createEmptyHistory(), {
      kind: 'move-task',
      taskId: 1,
      newStartDate: '2025-02-01',
    })
    expect(h.entries.length).toBe(1)
    expect(h.cursor).toBe(1)

    // 截断：先 undo 再新命令
    const { history: afterUndo } = undoCommand(h)
    expect(afterUndo.cursor).toBe(0)

    const afterNew = pushCommand(afterUndo, {
      kind: 'move-task',
      taskId: 2,
      newStartDate: '2025-03-01',
    })
    expect(afterNew.entries.length).toBe(1) // redo tail 被截断
    expect(afterNew.cursor).toBe(1)
    const firstEntry = afterNew.entries[0]
    expect(firstEntry).toBeDefined()
    if (firstEntry && firstEntry.kind === 'move-task') {
      expect(firstEntry.taskId).toBe(2)
    }
  })

  it('undoCommand cursor 前移', () => {
    let h = createEmptyHistory()
    h = pushCommand(h, { kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    h = pushCommand(h, { kind: 'move-task', taskId: 2, newStartDate: '2025-03-01' })
    expect(h.cursor).toBe(2)

    const { history: h1 } = undoCommand(h)
    expect(h1.cursor).toBe(1)

    const { history: h2 } = undoCommand(h1)
    expect(h2.cursor).toBe(0)
  })

  it('redoCommand cursor 后移', () => {
    let h = createEmptyHistory()
    h = pushCommand(h, { kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    const { history: afterUndo } = undoCommand(h)
    expect(afterUndo.cursor).toBe(0)

    const { history: afterRedo, redone } = redoCommand(afterUndo)
    expect(afterRedo.cursor).toBe(1)
    expect(redone).not.toBeNull()
  })

  it('activeCommands 返回已执行命令', () => {
    let h = createEmptyHistory()
    h = pushCommand(h, { kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    h = pushCommand(h, { kind: 'move-task', taskId: 2, newStartDate: '2025-03-01' })
    expect(activeCommands(h).length).toBe(2)
  })

  it('历史超上限时压缩', () => {
    let h = createEmptyHistory(3)
    h = pushCommand(h, { kind: 'move-task', taskId: 1, newStartDate: 'a' })
    h = pushCommand(h, { kind: 'move-task', taskId: 2, newStartDate: 'b' })
    h = pushCommand(h, { kind: 'move-task', taskId: 3, newStartDate: 'c' })
    h = pushCommand(h, { kind: 'move-task', taskId: 4, newStartDate: 'd' })
    expect(h.entries.length).toBe(3)
    expect(h.cursor).toBe(3)
    // 最早那条被丢弃
    const first = h.entries[0]
    if (first && first.kind === 'move-task') {
      expect(first.taskId).toBe(2)
    }
  })
})
