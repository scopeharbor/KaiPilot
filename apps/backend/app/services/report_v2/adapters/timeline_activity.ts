/**
 * report_v2/adapters/timeline_activity —— Timeline 活动摘要数据源。
 *
 * 输出近期项目活动摘要。仅返回低敏信息，
 * 不包含完整正文或敏感事件。
 */
import AuditLog from '#models/audit_log'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeEmpty } from '../data_source_adapter.js'

export interface TimelineActivityData {
  totalRecentActions: number
  recentActions: Array<{
    actionType: string
    actorName: string
    timestamp: string
    summary: string
  }>
}

export class TimelineActivityAdapter implements DataSourceAdapter<TimelineActivityData> {
  readonly sourceKey = 'timeline_activity_summary'

  async aggregate(
    _organizationId: number,
    projectId: number,
    _userId: number,
    filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<TimelineActivityData>> {
    const fromDate = filters.fromDate
      ? new Date(filters.fromDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const query = AuditLog.query()
      .where('project_id', projectId)
      .where('created_at', '>=', fromDate.toISOString())
      .orderBy('created_at', 'desc')
      .limit(20)

    const logs = await query

    const actions = logs.map((log) => ({
      actionType: log.action ?? 'unknown',
      actorName: log.userId ? `用户 ${log.userId}` : '系统',
      timestamp: log.createdAt?.toISO?.() ?? '',
      summary: String(log.metadata?.event ?? log.action ?? ''),
    }))

    const data: TimelineActivityData = {
      totalRecentActions: actions.length,
      recentActions: actions,
    }

    if (actions.length === 0) {
      return makeEmpty(this.sourceKey, data, '近期无项目活动')
    }

    return makeSuccess(this.sourceKey, data)
  }
}
