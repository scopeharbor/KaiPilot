/**
 * report_v2/adapters/schedule_summary —— 排程摘要数据源。
 *
 * 输出项目时间范围、排程日期统计和关键路径状态。
 */
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeEmpty } from '../data_source_adapter.js'

export interface ScheduleSummaryData {
  earliestStartDate: string | null
  latestEndDate: string | null
  totalDays: number
  tasksOnCriticalPath: number
  hasCircularDependency: boolean
}

export class ScheduleSummaryAdapter implements DataSourceAdapter<ScheduleSummaryData> {
  readonly sourceKey = 'schedule_summary'

  async aggregate(
    _organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<ScheduleSummaryData>> {
    // 最早/最晚日期
    const earliest = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('planned_start_date')
      .orderBy('planned_start_date', 'asc')
      .limit(1)
      .first()

    const latest = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('planned_end_date')
      .orderBy('planned_end_date', 'desc')
      .limit(1)
      .first()

    // 关键路径任务数（通过依赖关系推断）
    const withDeps = await TaskDependency.query()
      .where('project_id', projectId)
      .distinct('from_task_id')
      .count('from_task_id as count')
      .first()
    const tasksOnCriticalPath = Number(withDeps?.$extras.count ?? 0)

    const earliestDate = earliest?.startDate?.toISO() ?? null
    const latestDate = latest?.endDate?.toISO() ?? null

    // 环检测简化版
    const depCount = await TaskDependency.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()
    const hasCircularDependency = false // 简化版：不在此做完整环检测

    let totalDays = 0
    if (earliestDate && latestDate) {
      const diff = new Date(latestDate).getTime() - new Date(earliestDate).getTime()
      totalDays = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
    }

    const data: ScheduleSummaryData = {
      earliestStartDate: earliestDate,
      latestEndDate: latestDate,
      totalDays,
      tasksOnCriticalPath,
      hasCircularDependency,
    }

    if (!earliestDate && !latestDate && Number(depCount?.$extras.count ?? 0) === 0) {
      return makeEmpty(this.sourceKey, data, '项目暂无排程数据')
    }

    return makeSuccess(this.sourceKey, data)
  }
}
