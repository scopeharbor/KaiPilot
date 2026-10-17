import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import db from '@adonisjs/lucid/services/db'
import type {
  DelayDependencyWarning,
  DelayOverdueTask,
  DelaySnapshot,
  DelayUpcomingTask,
} from '@aiproj/types'
import {
  daysDiff,
  type AggregatorContext,
  type ReportAggregator,
  type AggregatorSnapshotWithoutMetadata,
} from './aggregator_context.js'

/**
 * 延期聚合器（design D2/D8；spec 需求「延期报表口径」）。
 *
 * 数据源：`tasks`（未软删除，含 end_date/actual_end_date/status）+ `task_dependencies`。
 *   - 已延期：`end_date < now` 且未完成，或 `actual_end_date > end_date`；
 *   - 即将到期：`end_date` 在 `[now, now+7d]` 且未完成；
 *   - 依赖 warning：前置任务已延期而后置未完成，`design D4 反幻觉` 检查项。
 * 计算完全在服务端，客户端提交的统计禁止作为事实来源。
 */
export default class DelayAggregator implements ReportAggregator<DelaySnapshot> {
  readonly template = 'delay' as const

  async aggregate(
    ctx: AggregatorContext,
  ): Promise<AggregatorSnapshotWithoutMetadata<DelaySnapshot>> {
    const projectId = Number(ctx.project.id)
    const now = ctx.now
    const upcomingCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const allTasks = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('end_date')
      .preload('assignee')
      .orderBy('end_date', 'asc')

    const totalWithDueDate = allTasks.length
    const overdueTasks: DelayOverdueTask[] = []
    const upcomingTasks: DelayUpcomingTask[] = []
    let overdueSum = 0
    let overdueMax = 0

    for (const task of allTasks) {
      const endIso = task.endDate?.toISODate()
      if (!endIso) continue
      const end = new Date(endIso)
      const isCompleted = task.status === 'completed'
      const isCancelled = task.status === 'cancelled'
      if (isCancelled) continue

      const assigneeName =
        (task.assignee as unknown as { fullName?: string | null })?.fullName ?? undefined
      const actualIso = task.actualEndDate?.toISODate() ?? null

      if (isCompleted) {
        // 已完成但比计划晚：算入历史延期
        if (actualIso) {
          const actual = new Date(actualIso)
          const overdueDaysNum = daysDiff(end, actual)
          if (overdueDaysNum > 0) {
            overdueTasks.push({
              taskId: Number(task.id),
              title: task.name,
              assigneeName,
              plannedEndDate: endIso,
              actualEndDate: actualIso,
              overdueDays: overdueDaysNum,
              onCriticalPath: Boolean(task.isCriticalPath),
            })
            overdueSum += overdueDaysNum
            if (overdueDaysNum > overdueMax) overdueMax = overdueDaysNum
          }
        }
        continue
      }

      const overdueDaysNum = daysDiff(end, now)
      if (overdueDaysNum > 0) {
        overdueTasks.push({
          taskId: Number(task.id),
          title: task.name,
          assigneeName,
          plannedEndDate: endIso,
          actualEndDate: null,
          overdueDays: overdueDaysNum,
          onCriticalPath: Boolean(task.isCriticalPath),
        })
        overdueSum += overdueDaysNum
        if (overdueDaysNum > overdueMax) overdueMax = overdueDaysNum
      } else if (end <= upcomingCutoff) {
        upcomingTasks.push({
          taskId: Number(task.id),
          title: task.name,
          assigneeName,
          plannedEndDate: endIso,
          daysUntilDue: -overdueDaysNum,
        })
      }
    }

    // 依赖 warning：找出 predecessor 已延期而 successor 未完成
    let dependencyWarnings: DelayDependencyWarning[] = []
    if (overdueTasks.length > 0) {
      const overdueTaskIdSet = new Set(overdueTasks.map((t) => t.taskId))
      // 查所有项目内的依赖关系（通过 predecessor 属于本项目过滤）
      const deps = await TaskDependency.query()
        .whereIn('predecessor_id', Array.from(overdueTaskIdSet))
        .limit(200)

      if (deps.length > 0) {
        const successorIds = Array.from(new Set(deps.map((d) => Number(d.successorId))))
        const successorRows = await db
          .from('tasks')
          .whereIn('id', successorIds)
          .where('project_id', projectId)
          .whereNotIn('status', ['completed', 'cancelled'])
          .whereNull('deleted_at')
          .select('id', 'name')

        const successorMap = new Map<number, string>()
        for (const row of successorRows) successorMap.set(Number(row.id), String(row.name))

        dependencyWarnings = deps
          .filter((d) => successorMap.has(Number(d.successorId)))
          .slice(0, 50)
          .map((d) => ({
            fromTaskId: Number(d.predecessorId),
            toTaskId: Number(d.successorId),
            reason: '前置任务已延期，后置任务尚未完成',
          }))
      }
    }

    const overdueCount = overdueTasks.length
    const delayRatePercent =
      totalWithDueDate === 0 ? 0 : Math.round((overdueCount / totalWithDueDate) * 10000) / 100
    const averageOverdueDays =
      overdueCount === 0 ? 0 : Math.round((overdueSum / overdueCount) * 100) / 100

    if (totalWithDueDate === 0) {
      ctx.warnings.push({
        level: 'info',
        message: '项目暂无带截止日期的任务，延期报表为空',
      })
    }

    return {
      template: 'delay',
      summary: {
        projectId,
        projectName: ctx.project.name,
        totalTasksWithDueDate: totalWithDueDate,
        overdueTasks: overdueCount,
        upcomingTasks: upcomingTasks.length,
        delayRatePercent,
        averageOverdueDays,
        maxOverdueDays: overdueMax,
      },
      overdueTasks: overdueTasks.slice(0, 100),
      upcomingTasks: upcomingTasks.slice(0, 100),
      dependencyWarnings,
    }
  }
}
