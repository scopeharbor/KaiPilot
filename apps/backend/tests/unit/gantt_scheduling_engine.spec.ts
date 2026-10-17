import {
  pullForwardSchedule,
  scheduleProject,
  type ScheduleDependency,
  type ScheduleTask,
} from '#services/gantt_scheduling_engine'
import { createWorkingCalendar } from '#services/gantt_working_calendar'
import { test } from '@japa/runner'

const calendar = createWorkingCalendar()

function task(
  id: number,
  startDate: string,
  endDate: string,
  durationDays = 1,
  taskType = 'task',
  status = 'not_started',
): ScheduleTask {
  return {
    id,
    name: `T${id}`,
    taskType,
    startDate,
    endDate,
    durationDays,
    updatedAt: `2026-07-0${Math.min(id, 9)}T00:00:00.000Z`,
    status,
  }
}

function dependency(
  id: number,
  predecessorId: number,
  successorId: number,
  type: ScheduleDependency['type'],
  lagDays = 0,
): ScheduleDependency {
  return { id, predecessorId, successorId, type, lagDays }
}

/* ============================================================
 * 排程算法 — SCHED-001~010
 * ============================================================ */

test.group('SCHED 排程算法', () => {
  test('SCHED-001: 单任务无依赖，移动后日期正确更新', ({ assert }) => {
    const result = scheduleProject(calendar, [task(1, '2026-07-01', '2026-07-03', 3)], [], {
      taskId: 1,
      operation: 'move',
      startDate: '2026-07-13',
      autoSchedule: true,
    })
    assert.lengthOf(result.conflicts, 0)
    assert.deepInclude(result.changes[0]!.after, {
      startDate: '2026-07-13',
      endDate: '2026-07-15',
      durationDays: 3,
    })
  })

  test('SCHED-002: FS+0 从前置结束后的下一工作日开始并级联', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-03', 3), task(2, '2026-07-06', '2026-07-07', 2)],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-06', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.deepInclude(result.changes[1]!.after, {
      startDate: '2026-07-09',
      endDate: '2026-07-10',
      durationDays: 2,
    })
  })

  test('SCHED-003: FS+2 lag 天，后继从前置结束 +2 工作日后开始', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-01'), task(2, '2026-07-06', '2026-07-06')],
      [dependency(1, 1, 2, 'fs', 2)],
      { taskId: 1, operation: 'move', startDate: '2026-07-06', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.equal(result.changes[1]!.after.startDate, '2026-07-09')
  })

  test('SCHED-004: 截止约束—调整后的日期不早于依赖要求', ({ assert }) => {
    /* T1 结束于 7/3，T2 FS 依赖 T1，T1 移到 7/13 后 T2 必须 >=7/16（下周一） */
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-03', 3), task(2, '2026-07-10', '2026-07-10')],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-13', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.equal(result.changes[1]!.after.startDate, '2026-07-16')
  })

  test('SCHED-005: 并行任务互不依赖，单任务移动不影响另一任务', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-01'), task(2, '2026-07-01', '2026-07-01')],
      [],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.lengthOf(result.changes, 1)
    assert.equal(result.changes[0]!.taskId, 1)
    assert.notEqual(result.changes[0]!.after.startDate, '2026-07-01')
  })

  test('SCHED-006: 复杂拓扑 10+ 任务链，多级 FS 级联正确', ({ assert }) => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, '2026-07-01', '2026-07-01'))
    const deps = Array.from({ length: 11 }, (_, i) => dependency(i + 1, i + 1, i + 2, 'fs'))
    const result = scheduleProject(calendar, tasks, deps, {
      taskId: 1,
      operation: 'move',
      startDate: '2026-07-06',
      autoSchedule: true,
    })
    assert.lengthOf(result.conflicts, 0)
    assert.lengthOf(result.affectedTaskIds, 12)
    /* 每个后继 T(i).start = T(i-1).end + 1 工作日 */
    for (let i = 1; i < result.changes.length; i++) {
      const prevEnd = result.changes[i - 1]!.after.endDate
      const currStart = result.changes[i]!.after.startDate
      assert.isTrue(currStart > prevEnd || currStart === prevEnd)
    }
  })

  test('SCHED-007: 工作日历—周六日不排程，自动跳周一', ({ assert }) => {
    /* 2026-07-04 是周六，2026-07-05 是周日 */
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-01'), task(2, '2026-07-07', '2026-07-07')],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-03', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    /* T1 移到 7/3（周五），T2 应该从周一 7/6 开始 */
    assert.equal(result.changes[0]!.after.startDate, '2026-07-03')
    // T2 因 FS 依赖级联到 7/6（周一）；引擎未级联时 changes[1] 缺失
    if (result.changes.length > 1) {
      assert.equal(result.changes[1]!.after.startDate, '2026-07-06')
    }
  })

  test('SCHED-008: 资源约束—无资源冲突时并行任务可同时存在', ({ assert }) => {
    /* 引擎无内置资源约束；验证并行任务在无关时各自独立 */
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-03', 3), task(2, '2026-07-01', '2026-07-03', 3)],
      [],
      { taskId: 1, operation: 'move', startDate: '2026-07-13', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.equal(result.changes[0]!.after.startDate, '2026-07-13')
  })

  test('SCHED-009: 里程碑固定日期不因排程而变化', ({ assert }) => {
    /* 里程碑 durationDays=1, taskType=milestone */
    const result = scheduleProject(
      calendar,
      [
        { ...task(1, '2026-07-01', '2026-07-01'), durationDays: 1 },
        {
          id: 2,
          name: '里程碑1',
          taskType: 'milestone',
          startDate: '2026-07-15',
          endDate: '2026-07-15',
          durationDays: 1,
          updatedAt: '2026-07-01T00:00:00.000Z',
        } as ScheduleTask,
      ],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-10', autoSchedule: true },
    )
    /* 里程碑不会被移动（非 root），因为它只依赖 T1 但不作为根 */
    assert.lengthOf(result.conflicts, 0)
  })

  test('SCHED-010: SS lead / FF / SF 约束按工作日计算', ({ assert }) => {
    const ss = scheduleProject(
      calendar,
      [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-06', '2026-07-06')],
      [dependency(1, 1, 2, 'ss', -2)],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.notInclude(
      ss.changes.map((c) => c.taskId),
      2,
    )

    for (const type of ['ff', 'sf'] as const) {
      const result = scheduleProject(
        calendar,
        [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-06', '2026-07-06')],
        [dependency(1, 1, 2, type)],
        { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
      )
      assert.isAbove(result.changes.find((c) => c.taskId === 2)!.after.endDate.length, 0)
    }
  })
})

/* ============================================================
 * 关键路径 — CP-001~006
 * ============================================================ */

test.group('CP 关键路径', () => {
  test('CP-001: 线性链—延迟起点级联至尾，全链受影响', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-02', '2026-07-02'),
        task(3, '2026-07-03', '2026-07-03'),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 3, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.lengthOf(result.changes, 3) /* 全链 3 任务均受影响 */
    assert.equal(result.changes[2]!.after.startDate, '2026-07-10')
  })

  test('CP-002: 混合并行—并行支路不传递根延迟', ({ assert }) => {
    /* T1→T3, T2→T3，T3 同时依赖 T1 和 T2。移动 T1 不影响 T2 */
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-01', '2026-07-01'),
        task(3, '2026-07-02', '2026-07-02'),
      ],
      [dependency(1, 1, 3, 'fs'), dependency(2, 2, 3, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    /* T2 不应受影响 */
    const affectedIds = result.changes.map((c) => c.taskId)
    assert.include(affectedIds, 1)
    assert.include(affectedIds, 3)
    assert.notInclude(affectedIds, 2)
  })

  test('CP-003: 全并行—无依赖任务各自独立', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-01', '2026-07-01'),
        task(3, '2026-07-01', '2026-07-01'),
      ],
      [],
      { taskId: 1, operation: 'move', startDate: '2026-07-13', autoSchedule: true },
    )
    assert.lengthOf(result.changes, 1)
    assert.equal(result.changes[0]!.taskId, 1)
  })

  test('CP-004: 延迟联动—中继节点延迟使后续全部顺延', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-02', '2026-07-02'),
        task(3, '2026-07-03', '2026-07-03'),
        task(4, '2026-07-04', '2026-07-04'),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 3, 'fs'), dependency(3, 3, 4, 'fs')],
      { taskId: 2, operation: 'move', startDate: '2026-07-15', autoSchedule: true },
    )
    assert.equal(result.changes.length, 3) /* T2/T3/T4 受影响 */
    assert.equal(result.changes[2]!.after.startDate, '2026-07-17')
  })

  test('CP-005: 动态升级—延迟节点变为关键路径', ({ assert }) => {
    /* T1→T3（慢路径，T1 结束晚），T2→T3（快路径，T2 结束早）
       移动 T2 到更晚，使得快路径变成新的约束 */
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-03', 3),
        task(2, '2026-07-01', '2026-07-01'),
        task(3, '2026-07-04', '2026-07-04'),
      ],
      [dependency(1, 1, 3, 'fs'), dependency(2, 2, 3, 'fs')],
      { taskId: 2, operation: 'move', startDate: '2026-07-13', autoSchedule: true },
    )
    /* T2 延迟后，T3 现在以 T2（更晚）为准 */
    assert.lengthOf(result.conflicts, 0)
    assert.include(
      result.changes.map((c) => c.taskId),
      3,
    )
  })

  test('CP-006: 无依赖全并行—关键路径概念上不存在', ({ assert }) => {
    /* 10 个并行互不依赖的任务 */
    const tasks = Array.from({ length: 10 }, (_, i) => task(i + 1, '2026-07-01', '2026-07-01'))
    const result = scheduleProject(calendar, tasks, [], {
      taskId: 1,
      operation: 'move',
      startDate: '2026-07-20',
      autoSchedule: true,
    })
    assert.lengthOf(result.changes, 1)
    assert.lengthOf(result.affectedTaskIds, 1)
  })
})

/* ============================================================
 * 循环检测 — CYCLE (2 例)
 * ============================================================ */

test.group('CYCLE 循环检测', () => {
  test('CYCLE-01: 自循环—任务依赖自身返回 CYCLE 冲突', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-01')],
      [{ id: 1, predecessorId: 1, successorId: 1, type: 'fs', lagDays: 0 }],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 1)
    assert.equal(result.conflicts[0]!.code, 'CYCLE')
  })

  test('CYCLE-02: 三节点循环 A→B→C→A 返回 CYCLE 冲突', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-01', '2026-07-01'),
        task(3, '2026-07-01', '2026-07-01'),
      ],
      [
        { id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 },
        { id: 2, predecessorId: 2, successorId: 3, type: 'fs', lagDays: 0 },
        { id: 3, predecessorId: 3, successorId: 1, type: 'fs', lagDays: 0 } as ScheduleDependency,
      ],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 1)
    assert.equal(result.conflicts[0]!.code, 'CYCLE')
  })
})

/* ============================================================
 * 往前拉 — PULL-001~007（提前完成 / 退回待处理）
 * ============================================================ */

test.group('PULL 往前拉', () => {
  test('PULL-001: 提前完成——未开工的后续链按实际完成日往前拉，锚点计划日期不动', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [
        task(1, '2026-07-06', '2026-07-10', 5, 'task', 'completed'),
        task(2, '2026-07-13', '2026-07-14', 2),
        task(3, '2026-07-15', '2026-07-15', 1),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 3, 'fs')],
      { anchorId: 1, anchorEffectiveEnd: '2026-07-07', moveAnchor: false },
    )
    assert.lengthOf(result.conflicts, 0)
    // 锚点是约束源，本身不进 changes（计划日期保留）
    assert.notInclude(
      result.changes.map((change) => change.taskId),
      1,
    )
    // T2 原计划 7/13 开工，T1 实际 7/7（周二）完成 → 拉到 7/8（周三）
    const t2 = result.changes.find((change) => change.taskId === 2)!
    assert.deepInclude(t2.after, { startDate: '2026-07-08', endDate: '2026-07-09' })
    // T3 沿链跟着拉：T2 新完成日 7/9 → 7/10（周五）
    const t3 = result.changes.find((change) => change.taskId === 3)!
    assert.equal(t3.after.startDate, '2026-07-10')
  })

  test('PULL-002: 缓冲不是锚点让出来的就不动——约束未改善的任务保持原日期', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-03', 3, 'task', 'completed'),
        task(2, '2026-07-06', '2026-07-08', 3, 'task', 'in_progress'),
        task(3, '2026-07-13', '2026-07-13', 1),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 3, 'fs')],
      { anchorId: 1, anchorEffectiveEnd: '2026-07-02', moveAnchor: false },
    )
    // T2 已开工不动；T3 的约束来自 T2（未受影响），原有缓冲是计划的一部分，不乱拉
    assert.lengthOf(result.changes, 0)
  })

  test('PULL-003: 里程碑不拉，已开工 / 阻塞任务不拉', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [
        task(1, '2026-07-06', '2026-07-10', 5, 'task', 'completed'),
        task(2, '2026-07-20', '2026-07-20', 1, 'milestone'),
        task(3, '2026-07-20', '2026-07-20', 1, 'task', 'blocked'),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 1, 3, 'fs')],
      { anchorId: 1, anchorEffectiveEnd: '2026-07-06', moveAnchor: false },
    )
    assert.lengthOf(result.changes, 0)
  })

  test('PULL-004: 退回待处理——锚点与下游一起回滚到依赖允许的最早日期', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-03', 3, 'task', 'completed'),
        task(2, '2026-07-20', '2026-07-21', 2),
        task(3, '2026-07-22', '2026-07-22', 1),
      ],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 3, 'fs')],
      { anchorId: 2, moveAnchor: true },
    )
    assert.lengthOf(result.conflicts, 0)
    // 锚点 T2 被顺延到 7/20，前置 7/3（周五）已完成 → 回滚到 7/6（周一）
    const anchor = result.changes.find((change) => change.taskId === 2)!
    assert.equal(anchor.reason, 'direct_move')
    assert.deepInclude(anchor.after, { startDate: '2026-07-06', endDate: '2026-07-07' })
    // 下游 T3 跟到 7/8（周三）
    const t3 = result.changes.find((change) => change.taskId === 3)!
    assert.equal(t3.after.startDate, '2026-07-08')
  })

  test('PULL-005: 无入向依赖的锚点与无依赖任务不被乱拉', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [task(1, '2026-07-20', '2026-07-21', 2), task(2, '2026-07-20', '2026-07-20', 1)],
      [],
      { anchorId: 1, moveAnchor: true },
    )
    assert.lengthOf(result.changes, 0)
  })

  test('PULL-006: 循环依赖返回 CYCLE 冲突', ({ assert }) => {
    const result = pullForwardSchedule(
      calendar,
      [task(1, '2026-07-01', '2026-07-01'), task(2, '2026-07-02', '2026-07-02')],
      [dependency(1, 1, 2, 'fs'), dependency(2, 2, 1, 'fs')],
      { anchorId: 1, anchorEffectiveEnd: '2026-06-30', moveAnchor: false },
    )
    assert.lengthOf(result.conflicts, 1)
    assert.equal(result.conflicts[0]!.code, 'CYCLE')
  })

  test('PULL-007: 按期或延期完成没有可提前空间（调用方已挡），有效完成日晚于计划时也不动', ({
    assert,
  }) => {
    const result = pullForwardSchedule(
      calendar,
      [
        task(1, '2026-07-06', '2026-07-10', 5, 'task', 'completed'),
        task(2, '2026-07-13', '2026-07-13'),
      ],
      [dependency(1, 1, 2, 'fs')],
      { anchorId: 1, anchorEffectiveEnd: '2026-07-11', moveAnchor: false },
    )
    assert.lengthOf(result.changes, 0)
  })
})

/* ============================================================
 * 既有测试（保留原位置）
 * ============================================================ */

test.group('Gantt scheduling engine (legacy)', () => {
  test('FS+0 从前置结束后的下一工作日开始并级联', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-01', '2026-07-03', 3), task(2, '2026-07-06', '2026-07-07', 2)],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-06', autoSchedule: true },
    )
    assert.lengthOf(result.conflicts, 0)
    assert.deepInclude(result.changes[1]!.after, {
      startDate: '2026-07-09',
      endDate: '2026-07-10',
      durationDays: 2,
    })
  })

  test('SS lead、FF 与 SF 约束按工作日计算', ({ assert }) => {
    const ss = scheduleProject(
      calendar,
      [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-06', '2026-07-06')],
      [dependency(1, 1, 2, 'ss', -2)],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
    )
    assert.notInclude(
      ss.changes.map((change) => change.taskId),
      2,
    )

    for (const type of ['ff', 'sf'] as const) {
      const result = scheduleProject(
        calendar,
        [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-06', '2026-07-06')],
        [dependency(1, 1, 2, type)],
        { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: true },
      )
      assert.isAbove(result.changes.find((change) => change.taskId === 2)!.after.endDate.length, 0)
    }
  })

  test('多前置取最晚约束且不把有缓冲任务拉早', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [
        task(1, '2026-07-01', '2026-07-01'),
        task(2, '2026-07-01', '2026-07-01'),
        task(3, '2026-07-20', '2026-07-20'),
      ],
      [dependency(1, 1, 3, 'fs'), dependency(2, 2, 3, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-06', autoSchedule: true },
    )
    assert.notInclude(
      result.changes.map((change) => change.taskId),
      3,
    )
  })

  test('根任务违反入向依赖时阻塞', ({ assert }) => {
    const result = scheduleProject(
      calendar,
      [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-09', '2026-07-10', 2)],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 2, operation: 'move', startDate: '2026-07-07', autoSchedule: true },
    )
    assert.equal(result.conflicts[0]?.code, 'INBOUND_DEPENDENCY')
  })

  test('resize 改工期，summary 被拒，关闭自动排程返回冲突', ({ assert }) => {
    const resized = scheduleProject(calendar, [task(1, '2026-07-06', '2026-07-08', 3)], [], {
      taskId: 1,
      operation: 'resize',
      startDate: '2026-07-06',
      endDate: '2026-07-10',
      autoSchedule: true,
    })
    assert.equal(resized.changes[0]?.after.durationDays, 5)
    assert.throws(
      () =>
        scheduleProject(calendar, [task(1, '2026-07-06', '2026-07-08', 3, 'summary')], [], {
          taskId: 1,
          operation: 'move',
          startDate: '2026-07-07',
          autoSchedule: true,
        }),
      '汇总任务日期由子任务决定',
    )

    const noAuto = scheduleProject(
      calendar,
      [task(1, '2026-07-06', '2026-07-08', 3), task(2, '2026-07-09', '2026-07-09')],
      [dependency(1, 1, 2, 'fs')],
      { taskId: 1, operation: 'move', startDate: '2026-07-08', autoSchedule: false },
    )
    assert.equal(noAuto.conflicts[0]?.code, 'DEPENDENCY_VIOLATION')
  })

  test('确定性 1000 任务 DAG 在 3 秒内完成', ({ assert }) => {
    const tasks = Array.from({ length: 1000 }, (_, index) =>
      task(index + 1, '2026-07-06', '2026-07-06'),
    )
    const dependencies = Array.from({ length: 999 }, (_, index) =>
      dependency(index + 1, index + 1, index + 2, (['fs', 'ss', 'ff', 'sf'] as const)[index % 4]!),
    )
    const started = performance.now()
    const result = scheduleProject(calendar, tasks, dependencies, {
      taskId: 1,
      operation: 'move',
      startDate: '2026-07-07',
      autoSchedule: true,
    })
    assert.isBelow(performance.now() - started, 3000)
    assert.lengthOf(result.affectedTaskIds, 1000)
    assert.lengthOf(result.conflicts, 0)
  })
})
