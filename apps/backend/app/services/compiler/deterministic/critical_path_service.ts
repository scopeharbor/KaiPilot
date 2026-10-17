/**
 * Deterministic Engine —— 关键路径服务。
 *
 * 在 PDM 任务图上计算 ES/EF/LS/LF/totalFloat/isCritical。
 * 使用 CPM（Critical Path Method）算法。
 *
 * @aiproj/backend
 */

import { DateTime } from 'luxon'
import type {
  CriticalPathResult,
  CriticalPathTaskResult,
  Dependency,
  GraphValidationResult,
  ScheduleResult,
  TaskDependency,
} from '@aiproj/compiler-spec'
import type { CriticalPathService, DeterministicContext } from './interfaces.js'
import { toDateTime } from './working_calendar.js'

export class CriticalPathCalculator implements CriticalPathService {
  readonly name = 'critical_path'

  async compute(
    scheduleResult: ScheduleResult,
    tasks: Record<string, TaskDependency>,
    dependencies: Dependency[],
    graphValidation: GraphValidationResult,
    _context: DeterministicContext,
  ): Promise<CriticalPathResult> {
    // 检查 graph/schedule 是否 blocking
    if (!graphValidation.passed) {
      return {
        tasks: {},
        criticalPathIds: [],
        projectDuration: 0,
        blocked: true,
        blockedReason: 'graph_validation_failed: graph 校验未通过，禁止关键路径计算',
      }
    }

    if (scheduleResult.blocked) {
      return {
        tasks: {},
        criticalPathIds: [],
        projectDuration: 0,
        blocked: true,
        blockedReason: 'schedule_failed: 排期失败，禁止关键路径计算',
      }
    }

    const taskIds = Object.keys(tasks)

    // ── 构建邻接表和逆邻接表 ──
    const successors = new Map<string, string[]>()
    const predecessors = new Map<string, string[]>()

    for (const tid of taskIds) {
      successors.set(tid, [])
      predecessors.set(tid, [])
    }

    // 从 dependsOn 和 dependencies 构建边
    for (const [tid, task] of Object.entries(tasks)) {
      for (const depId of task.dependsOn ?? []) {
        if (tasks[depId]) {
          successors.get(depId)?.push(tid)
          predecessors.get(tid)?.push(depId)
        }
      }
    }

    for (const dep of dependencies) {
      if (tasks[dep.predecessorId] && tasks[dep.successorId]) {
        if (!successors.get(dep.predecessorId)?.includes(dep.successorId)) {
          successors.get(dep.predecessorId)?.push(dep.successorId)
        }
        if (!predecessors.get(dep.successorId)?.includes(dep.predecessorId)) {
          predecessors.get(dep.successorId)?.push(dep.predecessorId)
        }
      }
    }

    // ── Forward pass: 计算 ES / EF ──
    const es = new Map<string, DateTime>()
    const ef = new Map<string, DateTime>()

    // 按拓扑顺序（从 schedule 结果推断）
    const sorted = topologicalSort(tasks, dependencies)
    if (!sorted) {
      return {
        tasks: {},
        criticalPathIds: [],
        projectDuration: 0,
        blocked: true,
        blockedReason: 'topological_sort_failed: 任务图存在依赖环',
      }
    }

    for (const tid of sorted) {
      const schedule = scheduleResult.scheduled[tid]
      if (!schedule) continue

      // taskDuration available from schedule if needed
      void schedule.durationWorkingDays

      const preds = predecessors.get(tid) ?? []
      if (preds.length === 0) {
        // 无前驱：从 schedule 获取开始
        es.set(tid, toDateTime(schedule.plannedStart))
        ef.set(tid, toDateTime(schedule.plannedEnd))
      } else {
        // Use schedule-derived ES/EF as authoritative
        es.set(tid, toDateTime(schedule.plannedStart))

        // EF = schedule's plannedEnd
        ef.set(tid, toDateTime(schedule.plannedEnd))
      }
    }

    // ── Backward pass: 计算 LF / LS ──
    const lf = new Map<string, DateTime>()
    const ls = new Map<string, DateTime>()

    // 确定项目结束（取所有没后继的 EF 的最大值）
    let projectEnd: DateTime | null = null
    for (const tid of sorted) {
      const succ = successors.get(tid) ?? []
      if (succ.length === 0) {
        const taskEf = ef.get(tid)
        if (taskEf && (!projectEnd || taskEf > projectEnd)) {
          projectEnd = taskEf
        }
      }
    }

    if (!projectEnd) {
      return {
        tasks: {},
        criticalPathIds: [],
        projectDuration: 0,
        blocked: false,
      }
    }

    // 反向遍历
    const reversed = [...sorted].reverse()
    for (const tid of reversed) {
      const schedule = scheduleResult.scheduled[tid]
      if (!schedule) continue

      const succ = successors.get(tid) ?? []
      if (succ.length === 0) {
        // 无后继：LF = 项目结束
        lf.set(tid, projectEnd)
        ls.set(tid, projectEnd)
      } else {
        // 取所有后继 LS 的最小值 = LF
        let minLs: DateTime | null = null
        for (const sid of succ) {
          const sLs = ls.get(sid)
          if (sLs && (!minLs || sLs < minLs)) {
            minLs = sLs
          }
        }
        if (!minLs) minLs = projectEnd
        lf.set(tid, minLs)

        // 回退 duration
        const sch = scheduleResult.scheduled[tid]
        if (sch) {
          // LS = LF - duration（大致估算）
          let dur = sch.durationWorkingDays
          if (dur <= 0) dur = 1
          // 按日回退
          ls.set(tid, minLs.minus({ days: dur - 1 }))
        } else {
          ls.set(tid, minLs)
        }
      }
    }

    // ── 计算 totalFloat 和 isCritical ──
    const tasksResult: Record<string, CriticalPathTaskResult> = {}
    const criticalPathIds: string[] = []

    for (const tid of sorted) {
      const schedule = scheduleResult.scheduled[tid]
      if (!schedule) continue

      const eS = es.get(tid)!
      const eF = ef.get(tid)!
      const lS = ls.get(tid)!
      const lF = lf.get(tid)!

      // totalFloat = LS - ES（天数差）
      const totalFloat = Math.round(lS.diff(eS, 'days').days)
      const isCritical = totalFloat === 0

      tasksResult[tid] = {
        taskId: tid,
        earliestStart: eS.toISODate() ?? '',
        earliestFinish: eF.toISODate() ?? '',
        latestStart: lS.toISODate() ?? '',
        latestFinish: lF.toISODate() ?? '',
        totalFloat,
        isCritical,
      }

      if (isCritical) {
        criticalPathIds.push(tid)
      }
    }

    const projectDurationDays =
      Math.round(projectEnd.diff(getEarliestStart(es, taskIds), 'days').days) + 1

    return {
      tasks: tasksResult,
      criticalPathIds,
      projectDuration: Math.max(0, projectDurationDays),
      blocked: false,
    }
  }
}

function getEarliestStart(es: Map<string, DateTime>, taskIds: string[]): DateTime {
  let earliest: DateTime | null = null
  for (const tid of taskIds) {
    const v = es.get(tid)
    if (v && (!earliest || v < earliest)) {
      earliest = v
    }
  }
  return earliest ?? DateTime.now().startOf('day')
}

function topologicalSort(
  tasks: Record<string, TaskDependency>,
  dependencies: Dependency[],
): string[] | null {
  const taskIds = Object.keys(tasks)
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const result: string[] = []
  let hasCycle = false

  function dfs(tid: string) {
    if (hasCycle) return
    if (inStack.has(tid)) {
      hasCycle = true
      return
    }
    if (visited.has(tid)) return

    inStack.add(tid)

    const task = tasks[tid]
    if (task) {
      for (const depId of task.dependsOn ?? []) {
        if (tasks[depId]) dfs(depId)
      }
    }

    for (const dep of dependencies) {
      if (dep.successorId === tid && tasks[dep.predecessorId]) {
        dfs(dep.predecessorId)
      }
    }

    inStack.delete(tid)
    visited.add(tid)
    result.push(tid)
  }

  for (const tid of taskIds) {
    if (!visited.has(tid)) dfs(tid)
  }

  return hasCycle ? null : result
}
