/**
 * Deterministic Engine —— 日期与排期引擎。
 *
 * 基于工作日历、任务持续时间、显式日期、依赖类型和 lag
 * 计算计划开始/结束日期，输出不可排期原因。
 *
 * FS: Finish-to-Start（前驱结束时后继才可开始）
 * SS: Start-to-Start（前驱开始后 X 天后继可开始）
 * FF: Finish-to-Finish（前驱结束后 X 天后继才结束）
 * SF: Start-to-Finish（前驱开始后 X 天后继才结束）
 *
 * @aiproj/backend
 */

import { DateTime } from 'luxon'
import type { GraphValidationResult, ScheduleResult, TaskDependency } from '@aiproj/compiler-spec'
import type { DeterministicContext, ScheduleService } from './interfaces.js'
import {
  DEFAULT_CALENDAR,
  durationToDateRange,
  nextWorkingDay,
  toDateStr,
  toDateTime,
} from './working_calendar.js'

export class ScheduleEngine implements ScheduleService {
  readonly name = 'schedule_engine'

  async compute(
    tasks: Record<string, TaskDependency>,
    graphValidation: GraphValidationResult,
    context: DeterministicContext,
  ): Promise<ScheduleResult> {
    // 检查 graph 是否 blocking
    if (!graphValidation.passed) {
      return {
        scheduled: {},
        blocked: true,
        unscheduledTaskIds: Object.keys(tasks),
        warnings: ['graph_validation_failed: 图校验未通过，无法排期'],
      }
    }

    const calendar = context.calendar ?? DEFAULT_CALENDAR
    const projectStart = toDateTime(context.projectStartDate)
    const scheduled: ScheduleResult['scheduled'] = {}
    const unscheduledTaskIds: string[] = []
    const warnings: string[] = []

    // 拓扑排序
    const sorted = this.#topologicalSort(tasks)

    if (sorted === null) {
      // 存在环
      return {
        scheduled: {},
        blocked: true,
        unscheduledTaskIds: Object.keys(tasks),
        warnings: ['topological_sort_failed: 任务图存在依赖环'],
      }
    }

    // 按拓扑顺序排期
    for (const tid of sorted) {
      const task = tasks[tid]
      if (!task) continue

      if (task.isMilestone) {
        // Milestone: duration=0，只标记日期
        const depDates = this.#getDependencyDates(tid, tasks, scheduled, calendar)
        const startDate = this.#resolveStartDate(
          task,
          depDates.latestEnd ?? projectStart,
          depDates.maxStart ?? null,
          calendar,
        )
        scheduled[tid] = {
          taskId: tid,
          plannedStart: toDateStr(startDate),
          plannedEnd: toDateStr(startDate),
          durationWorkingDays: 0,
          blocked: false,
        }
        continue
      }

      const duration = Math.max(1, task.duration ?? 1)

      // 收集依赖约束
      const depDates = this.#getDependencyDates(tid, tasks, scheduled, calendar)
      const explicitStart = task.explicitStart ? toDateTime(task.explicitStart) : null

      // 从依赖约束和显式日期中取最晚
      let effectiveStart: DateTime
      if (explicitStart && depDates.maxStart) {
        effectiveStart = explicitStart > depDates.maxStart ? explicitStart : depDates.maxStart
      } else if (depDates.maxStart) {
        effectiveStart = depDates.maxStart
      } else if (explicitStart) {
        effectiveStart = explicitStart
      } else {
        effectiveStart = projectStart
      }

      const { start, end } = durationToDateRange(effectiveStart, duration, calendar)
      const startStr = toDateStr(start)
      const endStr = toDateStr(end)

      if (!startStr || !endStr) {
        unscheduledTaskIds.push(tid)
        warnings.push(`任务 ${tid}: 日期转换失败`)
        continue
      }

      scheduled[tid] = {
        taskId: tid,
        plannedStart: startStr,
        plannedEnd: endStr,
        durationWorkingDays: duration,
        blocked: false,
      }
    }

    return {
      scheduled,
      blocked: false,
      unscheduledTaskIds,
      warnings,
    }
  }

  /**
   * 获取某个任务的前驱依赖日期约束。
   */
  #getDependencyDates(
    taskId: string,
    tasks: Record<string, TaskDependency>,
    scheduled: ScheduleResult['scheduled'],
    calendar: typeof DEFAULT_CALENDAR,
  ): { latestEnd: DateTime | null; maxStart: DateTime | null } {
    const task = tasks[taskId]
    if (!task) return { latestEnd: null, maxStart: null }

    let latestEnd: DateTime | null = null
    let maxStart: DateTime | null = null

    // 从 dependsOn 处理 FS 依赖
    for (const depId of task.dependsOn ?? []) {
      const depSchedule = scheduled[depId]
      if (depSchedule) {
        const depEnd = toDateTime(depSchedule.plannedEnd)
        // FS: 后继的开始 = 前驱的结束 + 1 工作日
        const nextDay = nextWorkingDay(depEnd.plus({ days: 1 }), calendar)
        if (!maxStart || nextDay > maxStart) {
          maxStart = nextDay
        }
        if (!latestEnd || depEnd > latestEnd) {
          latestEnd = depEnd
        }
      }
    }

    // 从 dependencies 处理精细依赖
    for (const dep of task.dependencies ?? []) {
      const depSchedule = scheduled[dep.predecessorId]
      if (!depSchedule) continue

      const depStart = toDateTime(depSchedule.plannedStart)
      const depEnd = toDateTime(depSchedule.plannedEnd)
      const lagDays = dep.lag ?? 0

      switch (dep.type ?? 'FS') {
        case 'FS': {
          // 前驱结束 + lag 天后可开始
          let candidate = depEnd.plus({ days: lagDays })
          if (lagDays >= 0) candidate = nextWorkingDay(candidate, calendar)
          if (!maxStart || candidate > maxStart) maxStart = candidate
          break
        }
        case 'SS': {
          // 前驱开始 + lag 天后可开始
          let candidate = depStart.plus({ days: lagDays })
          if (lagDays >= 0) candidate = nextWorkingDay(candidate, calendar)
          if (!maxStart || candidate > maxStart) maxStart = candidate
          break
        }
        case 'FF': {
          // 前驱结束 + lag 天后后继结束
          const finishTarget = depEnd.plus({ days: lagDays })
          if (!latestEnd || finishTarget > latestEnd) latestEnd = finishTarget
          break
        }
        case 'SF': {
          // 前驱开始 + lag 天后后继结束
          const finishTarget = depStart.plus({ days: lagDays })
          if (!latestEnd || finishTarget > latestEnd) latestEnd = finishTarget
          break
        }
      }
    }

    return { latestEnd, maxStart }
  }

  /**
   * 解析显式开始日期 vs 依赖约束。
   */
  #resolveStartDate(
    task: TaskDependency,
    depLatestEnd: DateTime | null,
    depMaxStart: DateTime | null,
    calendar: typeof DEFAULT_CALENDAR,
  ): DateTime {
    const explicitStart = task.explicitStart ? toDateTime(task.explicitStart) : null

    // 综合考虑
    const candidates: DateTime[] = []
    if (explicitStart) candidates.push(explicitStart)
    if (depMaxStart) candidates.push(depMaxStart)
    if (depLatestEnd) {
      const nextDay = nextWorkingDay(depLatestEnd.plus({ days: 1 }), calendar)
      candidates.push(nextDay)
    }

    if (candidates.length === 0) {
      return DateTime.now().startOf('day')
    }

    // 取最晚的
    let result = candidates[0]
    for (const c of candidates) {
      if (c > result) result = c
    }

    return nextWorkingDay(result, calendar)
  }

  /**
   * 拓扑排序（DFS 实现），检测环时返回 null。
   */
  #topologicalSort(tasks: Record<string, TaskDependency>): string[] | null {
    const taskIds = Object.keys(tasks)
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const result: string[] = []
    const hasCycle = { value: false }

    function dfs(tid: string) {
      if (hasCycle.value) return
      if (inStack.has(tid)) {
        hasCycle.value = true
        return
      }
      if (visited.has(tid)) return

      inStack.add(tid)

      const task = tasks[tid]
      if (task) {
        for (const depId of task.dependsOn ?? []) {
          if (tasks[depId]) {
            dfs(depId)
          }
        }
      }

      inStack.delete(tid)
      visited.add(tid)
      result.push(tid)
    }

    for (const tid of taskIds) {
      if (!visited.has(tid)) {
        dfs(tid)
      }
    }

    return hasCycle.value ? null : result
  }
}
