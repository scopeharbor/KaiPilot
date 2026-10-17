/**
 * report_v2/notification_integration —— V2 报表通知接入。
 *
 * 事件类型：
 * - report_generated：报表生成成功
 * - report_generation_failed：报表生成失败
 * - report_exported：导出文件可下载
 * - report_export_failed：导出失败
 *
 * 通知设计原则（D6）：
 * - 正文只含低敏状态、报表类型和安全入口
 * - 通知内不含完整报表正文、AI 草稿、文件路径或敏感指标
 * - 点击通知后执行权限复检
 * - 跨组织通知不可见（由通知服务 organization_id 过滤）
 */

/** 报表通知事件类型 */
export type ReportNotificationEvent =
  'report_generated' | 'report_generation_failed' | 'report_exported' | 'report_export_failed'

/** 通知输入 */
export interface ReportNotificationInput {
  organizationId: number
  recipientId: number
  projectId: number
  reportId: number
  versionId?: number
  templateId: string
  title: string
  event: ReportNotificationEvent
  errorCategory?: string
  downloadUrl?: string
}

/**
 * 构造报表通知内容。
 * 通知正文只含低敏信息，不含完整正文、AI 草稿、文件路径或敏感指标明细。
 */
export function buildReportNotification(input: ReportNotificationInput): {
  type: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'error'
  targetType: string
  targetId: number
  actionUrl: string | null
  metadata: Record<string, unknown>
} {
  const baseTitle = `报表「${input.title}」`
  const baseMeta: Record<string, unknown> = {
    reportId: input.reportId,
    templateId: input.templateId,
    projectId: input.projectId,
  }
  if (input.versionId) baseMeta.versionId = input.versionId

  switch (input.event) {
    case 'report_generated':
      return {
        type: 'report_generated',
        title: `${baseTitle}生成成功`,
        body: `报表「${input.title}」已成功生成，可查看详情和导出。`,
        severity: 'info',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports/v2/versions/${input.versionId}`,
        metadata: { ...baseMeta, status: 'success' },
      }

    case 'report_generation_failed':
      return {
        type: 'report_generation_failed',
        title: `${baseTitle}生成失败`,
        body: `报表「${input.title}」生成失败${input.errorCategory ? `（${input.errorCategory}）` : ''}，可检查后重试。`,
        severity: 'error',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports/v2/jobs`,
        metadata: { ...baseMeta, status: 'failed', errorCategory: input.errorCategory },
      }

    case 'report_exported':
      return {
        type: 'report_exported',
        title: `${baseTitle}导出完成`,
        body: `报表「${input.title}」导出文件已就绪，可前往下载。`,
        severity: 'info',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl:
          input.downloadUrl ??
          `/projects/${input.projectId}/reports/v2/versions/${input.versionId}`,
        metadata: { ...baseMeta, status: 'exported' },
      }

    case 'report_export_failed':
      return {
        type: 'report_export_failed',
        title: `${baseTitle}导出失败`,
        body: `报表「${input.title}」导出失败${input.errorCategory ? `（${input.errorCategory}）` : ''}，可检查后重试导出。`,
        severity: 'warning',
        targetType: 'report',
        targetId: input.reportId,
        actionUrl: `/projects/${input.projectId}/reports/v2/versions/${input.versionId}/exports`,
        metadata: { ...baseMeta, status: 'export_failed', errorCategory: input.errorCategory },
      }
  }
}
