import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import db from '@adonisjs/lucid/services/db'
import type {
  ProgressBlocker,
  ProgressCriticalTask,
  ProgressSnapshot,
  ProgressTaskStatusBucket,
  ProgressWbsSummary,
} from '@aiproj/types'
import {
  type AggregatorContext,
  type ReportAggregator,
  type AggregatorSnapshotWithoutMetadata,
} from './aggregator_context.js'

const STATUS_LIST = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const

/**
 * 进度聚合器（design D2 数据来源；spec「四类模板固定统计口径」）。
 *
 * 数据全部来自 `tasks`（未软删除）+ `wbs_nodes`：
 *   - 摘要：任务总数、按状态分桶、加权进度百分比；
 *   - 状态分布：完整六态；
 *   - WBS 摘要：按叶节点聚合；
 *   - 关键任务：`is_critical_path=true` 且未完成，取截止最近的 10 条；
 *   - 阻塞项：`status='blocked'` 或 `status='on_hold'`，取 10 条。
 */
export default class ProgressAggregator implements ReportAggregator<ProgressSnapshot> {
  readonly template = 'progress' as const

  async aggregate(
    ctx: AggregatorContext,
  ): Promise<AggregatorSnapshotWithoutMetadata<ProgressSnapshot>> {
    const projectId = Number(ctx.project.id)

    const [statusRows, criticalRaw, blockerRaw, wbsRoots] = await Promise.all([
      db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status')
        .count('* as count')
        .groupBy('status'),
      Task.query()
        .where('project_id', projectId)
        .where('is_critical_path', true)
        .whereNotIn('status', ['completed', 'cancelled'])
        .preload('assignee')
        .orderBy('end_date', 'asc')
        .limit(10),
      Task.query()
        .where('project_id', projectId)
        .whereIn('status', ['blocked', 'on_hold'])
        .orderBy('updated_at', 'desc')
        .limit(10),
      WbsNode.query()
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .orderBy('display_order', 'asc'),
    ])

    const statusCounts: Record<string, number> = Object.fromEntries(STATUS_LIST.map((s) => [s, 0]))
    let totalTasks = 0
    for (const row of statusRows) {
      const status = String(row.status)
      const count = Number(row.count)
      statusCounts[status] = count
      totalTasks += count
    }

    const statusDistribution: ProgressTaskStatusBucket[] = STATUS_LIST.map((status) => ({
      status,
      count: statusCounts[status] ?? 0,
      ratio: totalTasks > 0 ? Number((statusCounts[status]! / totalTasks).toFixed(4)) : 0,
    }))

    // 加权进度：所有未删除任务的 progress_percent 平均值；无任务时 0
    let overallProgressPercent = 0
    if (totalTasks > 0) {
      const avgRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .avg('progress_percent as avg')
      overallProgressPercent =
        Math.round((Number(avgRows[0]?.avg ?? 0) + Number.EPSILON) * 100) / 100
    }

    // WBS 摘要：按 leaf 聚合任务数与完成数
    const wbsSummaries: ProgressWbsSummary[] = []
    if (wbsRoots.length > 0) {
      const wbsIds = wbsRoots.map((n) => Number(n.id))
      const wbsTaskRows = await db
        .from('tasks')
        .whereIn('wbs_node_id', wbsIds)
        .whereNull('deleted_at')
        .select('wbs_node_id')
        .select(db.raw('COUNT(*) as total'))
        .select(db.raw(`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed`))
        .select(db.raw('AVG(progress_percent) as avg_progress'))
        .groupBy('wbs_node_id')

      const wbsMap = new Map<number, { total: number; completed: number; avg: number }>()
      for (const row of wbsTaskRows) {
        wbsMap.set(Number(row.wbs_node_id), {
          total: Number(row.total ?? 0),
          completed: Number(row.completed ?? 0),
          avg: Number(row.avg_progress ?? 0),
        })
      }

      for (const node of wbsRoots) {
        const entry = wbsMap.get(Number(node.id))
        if (!entry || entry.total === 0) continue
        wbsSummaries.push({
          wbsNodeId: Number(node.id),
          code: node.code ?? '',
          name: node.name,
          totalTasks: entry.total,
          completedTasks: entry.completed,
          progressPercent: Math.round(entry.avg * 100) / 100,
        })
      }
    } else {
      ctx.warnings.push({
        level: 'info',
        message: '当前项目暂无 WBS 节点，报表未包含 WBS 分节',
      })
    }

    const criticalTasks: ProgressCriticalTask[] = criticalRaw.map((task) => ({
      taskId: Number(task.id),
      title: task.name,
      status: task.status,
      progressPercent: Number(task.progressPercent),
      assigneeName:
        (task.assignee as unknown as { fullName?: string | null })?.fullName ?? undefined,
      dueDate: task.endDate?.toISODate() ?? undefined,
    }))

    if (criticalRaw.length === 0) {
      ctx.warnings.push({
        level: 'info',
        message: '未识别到关键路径任务；报表已省略关键任务分节',
      })
    }

    const blockers: ProgressBlocker[] = blockerRaw.map((task) => ({
      taskId: Number(task.id),
      title: task.name,
      reason: task.status === 'blocked' ? '任务被阻塞' : '任务已暂停',
    }))

    return {
      template: 'progress',
      summary: {
        projectId,
        projectName: ctx.project.name,
        overallProgressPercent,
        totalTasks,
        completedTasks: statusCounts.completed ?? 0,
        inProgressTasks: statusCounts.in_progress ?? 0,
        notStartedTasks: statusCounts.not_started ?? 0,
        blockedTasks: (statusCounts.blocked ?? 0) + (statusCounts.on_hold ?? 0),
      },
      statusDistribution,
      wbsSummaries,
      criticalTasks,
      blockers,
    }
  }
}
