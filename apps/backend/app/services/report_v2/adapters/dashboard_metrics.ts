/**
 * report_v2/adapters/dashboard_metrics —— Dashboard 指标数据源。
 *
 * 复用 Dashboard 的指标口径，扩展为可引用已确认健康诊断快照（v2-ai-project-health-diagnosis §6.4）。
 */
import Task from '#models/task'
import Milestone from '#models/milestone'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectMember from '#models/project_member'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeEmpty, makeWarning } from '../data_source_adapter.js'

export interface DashboardMetricsData {
  progressPercent: number
  healthStatus: string
  taskTotal: number
  overdueTaskCount: number
  soonDueTaskCount: number
  memberCount: number
  milestoneTotal: number
  completedMilestones: number
  /** v2-ai-project-health-diagnosis §6.5：已确认诊断引用信息 */
  healthDiagnosisRef?: {
    diagnosisId: number
    ruleVersion: string
    inputSignature: string
    evidenceHash: string | null
    stale: boolean
    confirmedBy: number | null
    confirmedAt: string | null
  }
  healthDiagnosisWarnings?: Array<{ dimension: string; code: string; message: string }>
}

export class DashboardMetricsAdapter implements DataSourceAdapter<DashboardMetricsData> {
  readonly sourceKey = 'dashboard_metrics'

  async aggregate(
    organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<DashboardMetricsData>> {
    const now = new Date().toISOString()
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // 任务统计
    const totalTasks = await Task.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()
    const completedTasks = await Task.query()
      .where('project_id', projectId)
      .where('status', 'completed')
      .count('id as count')
      .first()

    const completedCount = Number(completedTasks?.$extras.count ?? 0)
    const totalCount = Number(totalTasks?.$extras.count ?? 0)

    // 逾期
    const overdue = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('planned_end_date')
      .where('planned_end_date', '<', now)
      .whereNot('status', 'completed')
      .count('id as count')
      .first()

    // 即将到期（7天）
    const soonDue = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('planned_end_date')
      .where('planned_end_date', '>=', now)
      .where('planned_end_date', '<=', sevenDaysLater)
      .whereNot('status', 'completed')
      .count('id as count')
      .first()

    // 成员
    const members = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .count('id as count')
      .first()

    // 里程碑
    const milestones = await Milestone.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()
    const completedMilestones = await Milestone.query()
      .where('project_id', projectId)
      .where('status', 'completed')
      .count('id as count')
      .first()

    const progressPercent =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 10000) / 100 : 0

    const data: DashboardMetricsData = {
      progressPercent,
      healthStatus:
        progressPercent >= 80 ? 'healthy' : progressPercent >= 50 ? 'warning' : 'critical',
      taskTotal: totalCount,
      overdueTaskCount: Number(overdue?.$extras.count ?? 0),
      soonDueTaskCount: Number(soonDue?.$extras.count ?? 0),
      memberCount: Number(members?.$extras.count ?? 0),
      milestoneTotal: Number(milestones?.$extras.count ?? 0),
      completedMilestones: Number(completedMilestones?.$extras.count ?? 0),
    }

    // v2-ai-project-health-diagnosis §6.4/6.5：引用已确认健康诊断快照
    try {
      const diagnosis = await ProjectHealthDiagnosis.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('status', 'confirmed')
        .orderBy('generated_at', 'desc')
        .first()

      if (diagnosis) {
        data.healthDiagnosisRef = {
          diagnosisId: diagnosis.id,
          ruleVersion: diagnosis.ruleVersion,
          inputSignature: diagnosis.inputSignature,
          evidenceHash: diagnosis.evidenceHash,
          stale: diagnosis.stale,
          confirmedBy: diagnosis.confirmedBy,
          confirmedAt: diagnosis.confirmedAt?.toISO() ?? null,
        }
        data.healthDiagnosisWarnings =
          diagnosis.warnings?.map((w) => ({
            dimension: w.dimension,
            code: w.code,
            message: w.message,
          })) ?? []
      }
    } catch {
      // 诊断表不可用（如迁移未运行）时静默降级
    }

    const warnings = data.healthDiagnosisRef
      ? []
      : [
          makeWarning(
            'HEALTH_DIAGNOSIS_UNAVAILABLE',
            'info',
            '暂无已确认的健康诊断，报表使用基础聚合摘要',
          ),
        ]

    if (data.healthDiagnosisRef?.stale) {
      warnings.push(
        makeWarning(
          'HEALTH_DIAGNOSIS_STALE',
          'warning',
          '引用的已确认健康诊断已过期，请刷新诊断以获取最新健康态势',
        ),
      )
    }

    if (totalCount === 0) {
      return makeEmpty(this.sourceKey, data, '项目暂无数据')
    }

    return makeSuccess(this.sourceKey, data, warnings, 'project-dashboard.v1', now)
  }
}
