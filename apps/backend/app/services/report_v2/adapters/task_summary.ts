/**
 * report_v2/adapters/task_summary —— 任务/WBS/里程碑摘要数据源。
 *
 * 输出任务总数、完成数、进行中数、逾期数、WBS 分支统计和里程碑状态。
 */
import { DateTime } from 'luxon'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import Milestone from '#models/milestone'
import ProjectMember from '#models/project_member'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeEmpty } from '../data_source_adapter.js'

export interface TaskSummaryData {
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  notStartedTasks: number
  blockedTasks: number
  overdueTasks: number
  completedPercent: number
  wbsCount: number
  milestoneCount: number
  completedMilestones: number
  totalAssignees: number
  /** 估算工时合计（小时）；项目内无任何工时登记时为 null（诚实空态，不归零伪造）。 */
  estimatedHoursTotal: number | null
  /** 实际工时合计（小时）；无登记为 null。 */
  actualHoursTotal: number | null
  /** 有工时登记（估算或实际）的任务数。 */
  hoursRecordedTasks: number
}

export class TaskSummaryAdapter implements DataSourceAdapter<TaskSummaryData> {
  readonly sourceKey = 'task_summary'

  async aggregate(
    _organizationId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<TaskSummaryData>> {
    // 权限校验（简化：不在此做细粒度权限检查）
    // 完整权限在 Policy 层处理

    // 统计任务
    const now = DateTime.now().toISO()!
    const totalTasks = await Task.query()
      .where('project_id', _projectId)
      .count('id as count')
      .first()
    const completed = await Task.query()
      .where('project_id', _projectId)
      .where('status', 'completed')
      .count('id as count')
      .first()
    const inProgress = await Task.query()
      .where('project_id', _projectId)
      .where('status', 'in_progress')
      .count('id as count')
      .first()
    const blocked = await Task.query()
      .where('project_id', _projectId)
      .where('status', 'blocked')
      .count('id as count')
      .first()

    // 逾期任务
    const overdue = await Task.query()
      .where('project_id', _projectId)
      .whereNotNull('planned_end_date')
      .where('planned_end_date', '<', now)
      .whereNot('status', 'completed')
      .count('id as count')
      .first()

    const total = Number(totalTasks?.$extras.count ?? 0)
    const completedCount = Number(completed?.$extras.count ?? 0)
    const inProgressCount = Number(inProgress?.$extras.count ?? 0)
    const blockedCount = Number(blocked?.$extras.count ?? 0)
    const overdueCount = Number(overdue?.$extras.count ?? 0)

    // WBS 节点数
    const wbsCount = await WbsNode.query()
      .where('project_id', _projectId)
      .count('id as count')
      .first()

    // 里程碑
    const milestoneTotal = await Milestone.query()
      .where('project_id', _projectId)
      .count('id as count')
      .first()
    const milestoneDone = await Milestone.query()
      .where('project_id', _projectId)
      .where('status', 'completed')
      .count('id as count')
      .first()

    // 成员数
    const memberCount = await ProjectMember.query()
      .where('project_id', _projectId)
      .where('is_active', true)
      .count('id as count')
      .first()

    // 工时合计（只读聚合既有 estimated_hours / actual_hours 列；无登记保持 null 诚实空态）
    const hoursRow = await Task.query()
      .where('project_id', _projectId)
      .sum('estimated_hours as estimatedTotal')
      .sum('actual_hours as actualTotal')
      .first()
    const hoursRecordedRow = await Task.query()
      .where('project_id', _projectId)
      .where((q) => q.whereNotNull('estimated_hours').orWhereNotNull('actual_hours'))
      .count('id as count')
      .first()
    const estimatedTotalRaw = hoursRow?.$extras.estimatedTotal
    const actualTotalRaw = hoursRow?.$extras.actualTotal
    const hoursRecordedTasks = Number(hoursRecordedRow?.$extras.count ?? 0)

    const notStartedCount = total - completedCount - inProgressCount - blockedCount

    const data: TaskSummaryData = {
      totalTasks: total,
      completedTasks: completedCount,
      inProgressTasks: inProgressCount,
      notStartedTasks: Math.max(0, notStartedCount),
      blockedTasks: blockedCount,
      overdueTasks: overdueCount,
      completedPercent: total > 0 ? Math.round((completedCount / total) * 10000) / 100 : 0,
      wbsCount: Number(wbsCount?.$extras.count ?? 0),
      milestoneCount: Number(milestoneTotal?.$extras.count ?? 0),
      completedMilestones: Number(milestoneDone?.$extras.count ?? 0),
      totalAssignees: Number(memberCount?.$extras.count ?? 0),
      estimatedHoursTotal:
        estimatedTotalRaw === null || estimatedTotalRaw === undefined
          ? null
          : Number(estimatedTotalRaw),
      actualHoursTotal:
        actualTotalRaw === null || actualTotalRaw === undefined ? null : Number(actualTotalRaw),
      hoursRecordedTasks,
    }

    if (total === 0) {
      return makeEmpty(this.sourceKey, data, '项目暂无任务')
    }

    const warnings = overdueCount > 0 ? [] : []

    return makeSuccess(this.sourceKey, data, warnings)
  }
}
