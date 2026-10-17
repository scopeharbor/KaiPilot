import Milestone from '#models/milestone'
import Task from '#models/task'
import type { MilestoneEntry, MilestoneRiskItem, MilestoneSnapshot } from '@aiproj/types'
import {
  daysDiff,
  type AggregatorContext,
  type ReportAggregator,
  type AggregatorSnapshotWithoutMetadata,
} from './aggregator_context.js'

/**
 * 里程碑聚合器（design D2；spec 需求「里程碑报表口径」）。
 *
 * 数据源：`milestones`（不软删除，级联跟随项目）+ `tasks.milestone_id`。
 *   - 摘要：总数/已达成/已延期/即将到期；
 *   - 每个里程碑：状态、目标日期、关联任务完成度、延期天数、自动/人工设定标志；
 *   - 风险项：状态 `at_risk` 或即将到期但任务完成度 < 50%；
 * `MilestoneEntry.plannedDate` 若里程碑无 `planned_date` 视为无效数据，写入 warning 并跳过。
 */
export default class MilestoneAggregator implements ReportAggregator<MilestoneSnapshot> {
  readonly template = 'milestone' as const

  async aggregate(
    ctx: AggregatorContext,
  ): Promise<AggregatorSnapshotWithoutMetadata<MilestoneSnapshot>> {
    const projectId = Number(ctx.project.id)
    const now = ctx.now

    const milestoneQuery = Milestone.query().where('project_id', projectId)
    if (ctx.filters.milestoneIds && ctx.filters.milestoneIds.length > 0) {
      milestoneQuery.whereIn('id', ctx.filters.milestoneIds)
    }
    const milestones = await milestoneQuery.orderBy('planned_date', 'asc')

    // 关联任务（按 milestone_id 分组，聚合总数/完成数/平均进度）
    const milestoneIds = milestones.map((m) => Number(m.id))
    const taskMap = new Map<number, { total: number; completed: number; progress: number }>()
    if (milestoneIds.length > 0) {
      const tasks = await Task.query()
        .whereIn('milestone_id', milestoneIds)
        .select('milestoneId', 'status', 'progressPercent')
      for (const t of tasks) {
        const mid = Number(t.milestoneId)
        const entry = taskMap.get(mid) ?? { total: 0, completed: 0, progress: 0 }
        entry.total += 1
        if (t.status === 'completed') entry.completed += 1
        entry.progress += Number(t.progressPercent ?? 0)
        taskMap.set(mid, entry)
      }
    }

    const entries: MilestoneEntry[] = []
    const risks: MilestoneRiskItem[] = []
    let completedCount = 0
    let overdueCount = 0
    let upcomingCount = 0
    const upcomingCutoff = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    for (const milestone of milestones) {
      const plannedIso = milestone.plannedDate?.toISODate() ?? null
      if (!plannedIso) {
        ctx.warnings.push({
          level: 'warning',
          message: `里程碑 "${milestone.name}" 缺少目标日期`,
          context: { milestoneId: Number(milestone.id) },
        })
        continue
      }
      const planned = new Date(plannedIso)
      const linked = taskMap.get(Number(milestone.id)) ?? { total: 0, completed: 0, progress: 0 }
      const linkedTaskProgressPercent =
        linked.total === 0 ? 0 : Math.round((linked.progress / linked.total) * 100) / 100

      const isAchieved = milestone.status === 'achieved'
      const overdueDaysNum = isAchieved ? 0 : Math.max(0, daysDiff(planned, now))

      if (isAchieved) completedCount += 1
      else if (overdueDaysNum > 0) overdueCount += 1
      else if (planned <= upcomingCutoff) upcomingCount += 1

      entries.push({
        milestoneId: Number(milestone.id),
        name: milestone.name,
        plannedDate: plannedIso,
        status: milestone.status,
        linkedTaskCount: linked.total,
        linkedTaskCompletedCount: linked.completed,
        linkedTaskProgressPercent,
        overdueDays: overdueDaysNum,
        autoCalculated: milestone.autoCalculated,
      })

      // 风险判定
      if (milestone.status === 'at_risk') {
        risks.push({
          milestoneId: Number(milestone.id),
          name: milestone.name,
          reason: '状态标记为 at_risk',
        })
      } else if (!isAchieved && planned <= upcomingCutoff && linkedTaskProgressPercent < 50) {
        risks.push({
          milestoneId: Number(milestone.id),
          name: milestone.name,
          reason: '即将到期但关联任务完成度不足 50%',
        })
      } else if (!isAchieved && overdueDaysNum > 0) {
        risks.push({
          milestoneId: Number(milestone.id),
          name: milestone.name,
          reason: `已超过目标日期 ${overdueDaysNum} 天且未达成`,
        })
      }
    }

    if (milestones.length === 0) {
      ctx.warnings.push({
        level: 'info',
        message: '当前项目暂无里程碑，报表主体为空',
      })
    }

    return {
      template: 'milestone',
      summary: {
        projectId,
        projectName: ctx.project.name,
        totalMilestones: milestones.length,
        completedMilestones: completedCount,
        overdueMilestones: overdueCount,
        upcomingMilestones: upcomingCount,
      },
      milestones: entries,
      risks,
    }
  }
}
