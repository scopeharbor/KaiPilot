/**
 * report_v2/periodic_notification_integration —— AI 周期报表通知接入。
 *
 * 事件类型：
 * - periodic_draft_pending_review：草稿待审核
 * - periodic_draft_generation_failed：生成失败
 * - periodic_budget_blocked：预算阻断
 * - periodic_draft_confirmed：确认完成
 * - periodic_draft_returned：退回
 * - periodic_export_ready：导出可用
 *
 * 通知设计原则：
 * - 正文只含低敏状态、报表类型、周期范围和安全入口
 * - 通知内不含完整报表正文、AI 草稿、文件路径或敏感指标
 * - 目标导航后执行权限复检
 */
import type { ReportWarningLevel } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type PeriodicReportNotificationEvent =
  | 'periodic_draft_pending_review'
  | 'periodic_draft_generation_failed'
  | 'periodic_budget_blocked'
  | 'periodic_draft_confirmed'
  | 'periodic_draft_returned'
  | 'periodic_export_ready'

export interface PeriodicReportNotificationInput {
  organizationId: number
  recipientId: number
  projectId: number
  reportId: number
  versionId: number
  templateId: string
  periodType: 'weekly' | 'monthly'
  periodRange: { fromDate: string; toDate: string }
  title: string
  event: PeriodicReportNotificationEvent
  errorCategory?: string
}

// ---------------------------------------------------------------------------
// 通知构造
// ---------------------------------------------------------------------------

/**
 * 构造 AI 周期报表通知内容。
 * 通知正文只含低敏信息，不含完整正文、AI 草稿、prompt 或敏感指标明细。
 */
export function buildPeriodicReportNotification(input: PeriodicReportNotificationInput): {
  type: string
  title: string
  body: string
  severity: ReportWarningLevel
  targetType: string
  targetId: number
  actionUrl: string | null
  metadata: Record<string, unknown>
} {
  const periodLabel = input.periodType === 'weekly' ? '周报' : '月报'
  const baseTitle = `AI ${periodLabel}「${input.title}」`
  const baseMeta: Record<string, unknown> = {
    reportId: input.reportId,
    versionId: input.versionId,
    templateId: input.templateId,
    periodType: input.periodType,
    periodRange: input.periodRange,
  }

  switch (input.event) {
    case 'periodic_draft_pending_review':
      return {
        type: 'periodic_draft_pending_review',
        title: `${baseTitle}待审核`,
        body: `${baseTitle}已成功生成，请前往审核。`,
        severity: 'info',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/review`,
        metadata: { ...baseMeta, status: 'pending_review' },
      }

    case 'periodic_draft_generation_failed':
      return {
        type: 'periodic_draft_generation_failed',
        title: `${baseTitle}生成失败`,
        body: `${baseTitle}生成失败${input.errorCategory ? `（${input.errorCategory}）` : ''}，可检查后重试。`,
        severity: 'critical',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/jobs`,
        metadata: { ...baseMeta, status: 'failed', errorCategory: input.errorCategory },
      }

    case 'periodic_budget_blocked':
      return {
        type: 'periodic_budget_blocked',
        title: `${baseTitle}预算不足`,
        body: `${baseTitle}因预算限制被阻止，可查看详情后调整。`,
        severity: 'warning',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/preview`,
        metadata: { ...baseMeta, status: 'blocked', errorCategory: 'budget_blocked' },
      }

    case 'periodic_draft_confirmed':
      return {
        type: 'periodic_draft_confirmed',
        title: `${baseTitle}已确认`,
        body: `${baseTitle}已确认完成，可查看详情和导出。`,
        severity: 'info',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}`,
        metadata: { ...baseMeta, status: 'confirmed' },
      }

    case 'periodic_draft_returned':
      return {
        type: 'periodic_draft_returned',
        title: `${baseTitle}已退回`,
        body: `${baseTitle}已被退回，请查看退回原因后重新生成。`,
        severity: 'warning',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/review`,
        metadata: { ...baseMeta, status: 'rejected' },
      }

    case 'periodic_export_ready':
      return {
        type: 'periodic_export_ready',
        title: `${baseTitle}导出完成`,
        body: `${baseTitle}导出文件已就绪，可前往下载。`,
        severity: 'info',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/exports`,
        metadata: { ...baseMeta, status: 'exported' },
      }
  }
}
