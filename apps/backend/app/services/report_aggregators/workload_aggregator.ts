import Task from '#models/task'
import User from '#models/user'
import type { WorkloadAssigneeBucket, WorkloadSnapshot } from '@aiproj/types'
import {
  type AggregatorContext,
  type ReportAggregator,
  type AggregatorSnapshotWithoutMetadata,
} from './aggregator_context.js'

/**
 * 工作量聚合器（design D2；spec 需求「工作量报表口径」）。
 *
 * 数据源：`tasks`（未软删除）+ `users`。
 *   - 按 `assignee_id` 分桶（NULL 汇入 unassigned）；
 *   - 状态计数、计划工时、实际工时；
 *   - `overloadHint`：任一负责人计划工时 > 160h（M0 版粗略阈值，V2 接入资源模块细化）；
 *   - 未启用资源模块：`filters.assigneeIds` 过滤支持，但不融合资源分配数据。
 */
export default class WorkloadAggregator implements ReportAggregator<WorkloadSnapshot> {
  readonly template = 'workload' as const

  async aggregate(
    ctx: AggregatorContext,
  ): Promise<AggregatorSnapshotWithoutMetadata<WorkloadSnapshot>> {
    const projectId = Number(ctx.project.id)

    const query = Task.query().where('project_id', projectId)
    if (ctx.filters.assigneeIds && ctx.filters.assigneeIds.length > 0) {
      query.whereIn('assignee_id', ctx.filters.assigneeIds)
    }
    const tasks = await query.select('*')

    // 聚合到 bucket
    interface Accum {
      total: number
      completed: number
      inProgress: number
      notStarted: number
      plannedHours: number
      actualHours: number
    }
    const buckets = new Map<number, Accum>()
    let unassignedTotal = 0
    let unassignedPlannedHours = 0

    for (const task of tasks) {
      const planned = Number(task.estimatedHours ?? 0)
      const actual = Number(task.actualHours ?? 0)
      const assigneeId = task.assigneeId ? Number(task.assigneeId) : null
      if (assigneeId === null) {
        unassignedTotal += 1
        unassignedPlannedHours += planned
        continue
      }
      const acc =
        buckets.get(assigneeId) ??
        ({
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          plannedHours: 0,
          actualHours: 0,
        } satisfies Accum)
      acc.total += 1
      if (task.status === 'completed') acc.completed += 1
      else if (task.status === 'in_progress') acc.inProgress += 1
      else if (task.status === 'not_started') acc.notStarted += 1
      acc.plannedHours += planned
      acc.actualHours += actual
      buckets.set(assigneeId, acc)
    }

    // 补齐 displayName
    const userIds = Array.from(buckets.keys())
    const userMap = new Map<number, string>()
    if (userIds.length > 0) {
      const users = await User.query().whereIn('id', userIds).select('id', 'fullName', 'email')
      for (const u of users) {
        userMap.set(Number(u.id), u.fullName ?? u.email)
      }
    }

    const byAssignee: WorkloadAssigneeBucket[] = userIds
      .map((userId) => {
        const acc = buckets.get(userId)!
        return {
          userId,
          displayName: userMap.get(userId) ?? `用户 #${userId}`,
          totalTasks: acc.total,
          completedTasks: acc.completed,
          inProgressTasks: acc.inProgress,
          notStartedTasks: acc.notStarted,
          plannedHours: Math.round(acc.plannedHours * 100) / 100,
          actualHours: Math.round(acc.actualHours * 100) / 100,
          overloadHint: acc.plannedHours > 160,
        }
      })
      .sort((a, b) => b.totalTasks - a.totalTasks)

    const totalPlannedHours =
      Math.round(
        (byAssignee.reduce((s, b) => s + b.plannedHours, 0) + unassignedPlannedHours) * 100,
      ) / 100
    const totalActualHours =
      Math.round(byAssignee.reduce((s, b) => s + b.actualHours, 0) * 100) / 100

    if (byAssignee.length === 0 && unassignedTotal === 0) {
      ctx.warnings.push({
        level: 'info',
        message: '项目内暂无任务，工作量报表为空',
      })
    }

    if (unassignedTotal > 0) {
      ctx.warnings.push({
        level: 'warning',
        message: `存在 ${unassignedTotal} 条未分配负责人的任务`,
        context: { unassignedCount: unassignedTotal },
      })
    }

    // V2 提示：资源模块可用性
    ctx.warnings.push({
      level: 'info',
      message: '工作量报表未融合资源分配数据（V2 候选）',
    })

    return {
      template: 'workload',
      summary: {
        projectId,
        projectName: ctx.project.name,
        totalAssignees: byAssignee.length,
        totalPlannedHours,
        totalActualHours,
        unassigned: {
          totalTasks: unassignedTotal,
          plannedHours: Math.round(unassignedPlannedHours * 100) / 100,
        },
      },
      byAssignee,
    }
  }
}
