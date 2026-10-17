import {
  endFromStart,
  formatIsoDate,
  parseIsoDate,
  shiftWorkingDays,
  snapToWorkingDay,
  startFromEnd,
  workingDayDuration,
  type WorkingCalendar,
} from '#services/gantt_working_calendar'

export type ScheduleDependencyType = 'fs' | 'ss' | 'ff' | 'sf'
export type ScheduleOperation = 'move' | 'resize'

export interface ScheduleTask {
  id: number
  name: string
  taskType: string
  startDate: string
  endDate: string
  durationDays: number | null
  updatedAt: string | null
  /** 任务状态（not_started / in_progress / completed / blocked…）：往前拉只动未开工任务。 */
  status?: string
}

export interface ScheduleDependency {
  id: number
  predecessorId: number
  successorId: number
  type: ScheduleDependencyType
  lagDays: number
}

export interface ScheduleIntent {
  taskId: number
  operation: ScheduleOperation
  startDate: string
  endDate?: string | null
  autoSchedule: boolean
}

export interface ScheduleChange {
  taskId: number
  taskName: string
  before: { startDate: string; endDate: string; durationDays: number }
  after: { startDate: string; endDate: string; durationDays: number }
  reason: 'direct_move' | 'direct_resize' | 'dependency'
  dependencyIds: number[]
}

export interface ScheduleConflict {
  taskId: number
  taskName: string
  code: 'INBOUND_DEPENDENCY' | 'DEPENDENCY_VIOLATION' | 'CYCLE'
  message: string
  dependencyIds: number[]
}

export interface ScheduleResult {
  changes: ScheduleChange[]
  conflicts: ScheduleConflict[]
  warnings: string[]
  affectedTaskIds: number[]
}

interface TaskDates {
  start: number
  end: number
  durationDays: number
}

function datesFor(calendar: WorkingCalendar, task: ScheduleTask): TaskDates {
  const start = snapToWorkingDay(calendar, parseIsoDate(task.startDate), 1)
  const end = snapToWorkingDay(calendar, parseIsoDate(task.endDate), -1)
  const durationDays =
    task.taskType === 'milestone'
      ? 1
      : task.durationDays && task.durationDays > 0
        ? Math.trunc(task.durationDays)
        : workingDayDuration(calendar, start, end)
  return { start, end: task.taskType === 'milestone' ? start : end, durationDays }
}

function requiredStart(
  calendar: WorkingCalendar,
  dependency: ScheduleDependency,
  predecessor: TaskDates,
  successorDuration: number,
): number {
  switch (dependency.type) {
    case 'fs':
      return shiftWorkingDays(calendar, predecessor.end, dependency.lagDays + 1)
    case 'ss':
      return shiftWorkingDays(calendar, predecessor.start, dependency.lagDays)
    case 'ff': {
      const requiredEnd = shiftWorkingDays(calendar, predecessor.end, dependency.lagDays)
      return startFromEnd(calendar, requiredEnd, successorDuration)
    }
    case 'sf': {
      const requiredEnd = shiftWorkingDays(calendar, predecessor.start, dependency.lagDays)
      return startFromEnd(calendar, requiredEnd, successorDuration)
    }
  }
}

function collectAffected(rootId: number, outgoing: Map<number, ScheduleDependency[]>): Set<number> {
  const affected = new Set<number>([rootId])
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()!
    for (const dependency of outgoing.get(current) ?? []) {
      if (!affected.has(dependency.successorId)) {
        affected.add(dependency.successorId)
        queue.push(dependency.successorId)
      }
    }
  }
  return affected
}

function topologicalOrder(
  affected: Set<number>,
  dependencies: ScheduleDependency[],
): { order: number[]; cycle: boolean } {
  const indegree = new Map<number, number>([...affected].map((id) => [id, 0]))
  const outgoing = new Map<number, number[]>()
  for (const dependency of dependencies) {
    if (!affected.has(dependency.predecessorId) || !affected.has(dependency.successorId)) continue
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1)
    outgoing.set(dependency.predecessorId, [
      ...(outgoing.get(dependency.predecessorId) ?? []),
      dependency.successorId,
    ])
  }
  const queue = [...affected].filter((id) => indegree.get(id) === 0).sort((a, b) => a - b)
  const order: number[] = []
  while (queue.length) {
    const current = queue.shift()!
    order.push(current)
    for (const next of outgoing.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1
      indegree.set(next, degree)
      if (degree === 0) {
        queue.push(next)
        queue.sort((a, b) => a - b)
      }
    }
  }
  return { order, cycle: order.length !== affected.size }
}

export function scheduleProject(
  calendar: WorkingCalendar,
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
  intent: ScheduleIntent,
): ScheduleResult {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const root = tasksById.get(intent.taskId)
  if (!root) throw new Error('根任务不存在')
  if (root.taskType === 'summary') throw new Error('汇总任务日期由子任务决定')

  const outgoing = new Map<number, ScheduleDependency[]>()
  const incoming = new Map<number, ScheduleDependency[]>()
  for (const dependency of dependencies) {
    outgoing.set(dependency.predecessorId, [
      ...(outgoing.get(dependency.predecessorId) ?? []),
      dependency,
    ])
    incoming.set(dependency.successorId, [
      ...(incoming.get(dependency.successorId) ?? []),
      dependency,
    ])
  }
  const affected = collectAffected(root.id, outgoing)
  const topo = topologicalOrder(affected, dependencies)
  if (topo.cycle) {
    return {
      changes: [],
      conflicts: [
        {
          taskId: root.id,
          taskName: root.name,
          code: 'CYCLE',
          message: '依赖图存在循环，无法排程',
          dependencyIds: [],
        },
      ],
      warnings: [],
      affectedTaskIds: [...affected],
    }
  }

  const before = new Map<number, TaskDates>()
  for (const task of tasks) before.set(task.id, datesFor(calendar, task))
  const next = new Map<number, TaskDates>(before)
  const rootBefore = before.get(root.id)!
  const requestedStart = snapToWorkingDay(calendar, parseIsoDate(intent.startDate), 1)
  let rootAfter: TaskDates
  if (root.taskType === 'milestone') {
    rootAfter = { start: requestedStart, end: requestedStart, durationDays: 1 }
  } else if (intent.operation === 'resize') {
    const requestedEnd = snapToWorkingDay(
      calendar,
      parseIsoDate(intent.endDate ?? intent.startDate),
      1,
    )
    if (requestedEnd < rootBefore.start) throw new Error('结束日期不能早于开始日期')
    const durationDays = workingDayDuration(calendar, rootBefore.start, requestedEnd)
    rootAfter = { start: rootBefore.start, end: requestedEnd, durationDays }
  } else {
    rootAfter = {
      start: requestedStart,
      end: endFromStart(calendar, requestedStart, rootBefore.durationDays),
      durationDays: rootBefore.durationDays,
    }
  }
  next.set(root.id, rootAfter)

  const conflicts: ScheduleConflict[] = []
  const inboundRequirements = (incoming.get(root.id) ?? [])
    .map((dependency) => {
      const predecessor = next.get(dependency.predecessorId)
      return predecessor
        ? {
            dependency,
            start: requiredStart(calendar, dependency, predecessor, rootAfter.durationDays),
          }
        : null
    })
    .filter((value): value is { dependency: ScheduleDependency; start: number } => value !== null)
  const violatedInbound = inboundRequirements.filter(
    (requirement) => rootAfter.start < requirement.start,
  )
  if (violatedInbound.length) {
    conflicts.push({
      taskId: root.id,
      taskName: root.name,
      code: 'INBOUND_DEPENDENCY',
      message: '调整后的日期违反前置依赖约束',
      dependencyIds: violatedInbound.map(({ dependency }) => dependency.id),
    })
  }

  const dependencyReasons = new Map<number, number[]>()
  for (const taskId of topo.order) {
    if (taskId === root.id) continue
    const task = tasksById.get(taskId)
    const current = next.get(taskId)
    if (!task || !current) continue
    const requirements = (incoming.get(taskId) ?? [])
      .map((dependency) => {
        const predecessor = next.get(dependency.predecessorId)
        return predecessor
          ? {
              dependency,
              start: requiredStart(calendar, dependency, predecessor, current.durationDays),
            }
          : null
      })
      .filter((value): value is { dependency: ScheduleDependency; start: number } => value !== null)
    if (!requirements.length) continue
    const earliest = Math.max(...requirements.map(({ start }) => start))
    if (current.start >= earliest) continue
    const reasonIds = requirements
      .filter(({ start }) => start === earliest)
      .map(({ dependency }) => dependency.id)
    if (!intent.autoSchedule) {
      conflicts.push({
        taskId,
        taskName: task.name,
        code: 'DEPENDENCY_VIOLATION',
        message: '后续任务需要顺延，请启用自动排程',
        dependencyIds: reasonIds,
      })
      continue
    }
    next.set(taskId, {
      start: earliest,
      end:
        task.taskType === 'milestone'
          ? earliest
          : endFromStart(calendar, earliest, current.durationDays),
      durationDays: current.durationDays,
    })
    dependencyReasons.set(taskId, reasonIds)
  }

  const changes: ScheduleChange[] = []
  for (const taskId of topo.order) {
    const task = tasksById.get(taskId)
    const oldDates = before.get(taskId)
    const newDates = next.get(taskId)
    if (!task || !oldDates || !newDates) continue
    if (
      oldDates.start === newDates.start &&
      oldDates.end === newDates.end &&
      oldDates.durationDays === newDates.durationDays
    ) {
      continue
    }
    changes.push({
      taskId,
      taskName: task.name,
      before: {
        startDate: formatIsoDate(oldDates.start),
        endDate: formatIsoDate(oldDates.end),
        durationDays: oldDates.durationDays,
      },
      after: {
        startDate: formatIsoDate(newDates.start),
        endDate: formatIsoDate(newDates.end),
        durationDays: newDates.durationDays,
      },
      reason:
        taskId === root.id
          ? intent.operation === 'resize'
            ? 'direct_resize'
            : 'direct_move'
          : 'dependency',
      dependencyIds: dependencyReasons.get(taskId) ?? [],
    })
  }

  return {
    changes,
    conflicts,
    warnings: changes.length > 20 ? [`本次调整将影响 ${changes.length} 个任务`] : [],
    affectedTaskIds: topo.order,
  }
}

export interface PullForwardIntent {
  /** 锚点：提前完成的任务（moveAnchor=false）或退回待处理 / 重开的任务（moveAnchor=true）。 */
  anchorId: number
  /** 锚点的有效完成日（实际完成日 ISO，早于计划完成日才有意义）；缺省用计划日期。 */
  anchorEffectiveEnd?: string | null
  /** true = 锚点自身也拉回到依赖允许的最早日期（退回待处理 / 重开时回滚被顺延的排期）。 */
  moveAnchor: boolean
}

/**
 * 往前拉（只提前、不延后）：排期引擎的对称补充——scheduleProject 只把后继顺延，
 * 这里把任务拉回到依赖允许的最早开工日。两个触发场景：
 * - 任务提前完成（moveAnchor=false）：约束源改用实际完成日，未开工的后续任务往前拉；
 * - 退回待处理 / 重开（moveAnchor=true）：锚点自身与下游未开工任务一起回滚到最早可行日期。
 *
 * 只移动 not_started 的普通任务：已开工 / 已完成 / 阻塞的任务与里程碑（多为对外承诺日期）
 * 保持不动，它们的下游按现有日期计算约束。无入向依赖的任务不受锚点影响，不会被乱拉。
 */
export function pullForwardSchedule(
  calendar: WorkingCalendar,
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
  intent: PullForwardIntent,
): ScheduleResult {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const anchor = tasksById.get(intent.anchorId)
  if (!anchor) throw new Error('锚点任务不存在')

  const outgoing = new Map<number, ScheduleDependency[]>()
  const incoming = new Map<number, ScheduleDependency[]>()
  for (const dependency of dependencies) {
    outgoing.set(dependency.predecessorId, [
      ...(outgoing.get(dependency.predecessorId) ?? []),
      dependency,
    ])
    incoming.set(dependency.successorId, [
      ...(incoming.get(dependency.successorId) ?? []),
      dependency,
    ])
  }
  const affected = collectAffected(anchor.id, outgoing)
  const topo = topologicalOrder(affected, dependencies)
  if (topo.cycle) {
    return {
      changes: [],
      conflicts: [
        {
          taskId: anchor.id,
          taskName: anchor.name,
          code: 'CYCLE',
          message: '依赖图存在循环，无法排程',
          dependencyIds: [],
        },
      ],
      warnings: [],
      affectedTaskIds: [...affected],
    }
  }

  const before = new Map<number, TaskDates>()
  for (const task of tasks) before.set(task.id, datesFor(calendar, task))
  const next = new Map<number, TaskDates>(before)

  if (!intent.moveAnchor && intent.anchorEffectiveEnd) {
    const effectiveEnd = snapToWorkingDay(calendar, parseIsoDate(intent.anchorEffectiveEnd), -1)
    const planned = before.get(anchor.id)!
    if (effectiveEnd < planned.end) {
      // 锚点计划日期不动（保留计划留痕），仅约束源改用有效完成日；
      // 有效开始日同步倒推（SS/SF 依赖用它），且不晚于原计划开始日。
      next.set(anchor.id, {
        start: Math.min(planned.start, startFromEnd(calendar, effectiveEnd, planned.durationDays)),
        end: effectiveEnd,
        durationDays: planned.durationDays,
      })
    }
  }

  const movable = (task: ScheduleTask) =>
    task.taskType !== 'milestone' &&
    task.taskType !== 'summary' &&
    (task.status ?? 'not_started') === 'not_started'

  const dependencyReasons = new Map<number, number[]>()
  for (const taskId of topo.order) {
    const task = tasksById.get(taskId)
    const current = next.get(taskId)
    if (!task || !current) continue
    const isAnchor = taskId === anchor.id
    // 下游只动未开工任务；锚点在 moveAnchor 时是被显式退回 / 重开的，无论原状态都回滚。
    if (isAnchor ? !intent.moveAnchor : !movable(task)) continue
    if (task.taskType === 'milestone' || task.taskType === 'summary') continue
    const requirements = (incoming.get(taskId) ?? [])
      .map((dependency) => {
        const predecessor = next.get(dependency.predecessorId)
        const plannedPredecessor = before.get(dependency.predecessorId)
        return predecessor && plannedPredecessor
          ? {
              dependency,
              start: requiredStart(calendar, dependency, predecessor, current.durationDays),
              plannedStart: requiredStart(
                calendar,
                dependency,
                plannedPredecessor,
                current.durationDays,
              ),
            }
          : null
      })
      .filter(
        (value): value is { dependency: ScheduleDependency; start: number; plannedStart: number } =>
          value !== null,
      )
    if (!requirements.length) continue
    const earliest = Math.max(...requirements.map(({ start }) => start))
    // 与 scheduleProject 相反的对称分支：只提前，已经更早（仍有缓冲）的保持不动。
    if (current.start <= earliest) continue
    if (!intent.moveAnchor) {
      // 提前完成场景：只拉「约束确实因锚点改善」的任务。绑定约束来自未受影响的
      // 前置时（新旧最早日相同），任务原有的缓冲是计划的一部分，不动它。
      const plannedEarliest = Math.max(...requirements.map(({ plannedStart }) => plannedStart))
      if (earliest >= plannedEarliest) continue
    }
    const reasonIds = requirements
      .filter(({ start }) => start === earliest)
      .map(({ dependency }) => dependency.id)
    next.set(taskId, {
      start: earliest,
      end:
        task.taskType === 'milestone'
          ? earliest
          : endFromStart(calendar, earliest, current.durationDays),
      durationDays: current.durationDays,
    })
    dependencyReasons.set(taskId, reasonIds)
  }

  const changes: ScheduleChange[] = []
  for (const taskId of topo.order) {
    const task = tasksById.get(taskId)
    const oldDates = before.get(taskId)
    const newDates = next.get(taskId)
    if (!task || !oldDates || !newDates) continue
    if (
      oldDates.start === newDates.start &&
      oldDates.end === newDates.end &&
      oldDates.durationDays === newDates.durationDays
    ) {
      continue
    }
    // 锚点的有效完成日只是约束源，不落成日期变更（计划日期保留）。
    if (taskId === anchor.id && !intent.moveAnchor) continue
    changes.push({
      taskId,
      taskName: task.name,
      before: {
        startDate: formatIsoDate(oldDates.start),
        endDate: formatIsoDate(oldDates.end),
        durationDays: oldDates.durationDays,
      },
      after: {
        startDate: formatIsoDate(newDates.start),
        endDate: formatIsoDate(newDates.end),
        durationDays: newDates.durationDays,
      },
      reason: taskId === anchor.id ? 'direct_move' : 'dependency',
      dependencyIds: dependencyReasons.get(taskId) ?? [],
    })
  }

  return {
    changes,
    conflicts: [],
    warnings: changes.length > 20 ? [`本次调整将影响 ${changes.length} 个任务`] : [],
    affectedTaskIds: topo.order,
  }
}
