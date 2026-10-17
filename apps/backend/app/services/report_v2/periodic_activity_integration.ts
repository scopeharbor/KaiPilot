/**
 * report_v2/periodic_activity_integration —— AI 周期报表项目活动事件映射。
 *
 * 事件类型：
 * - report_periodic_preview_created：周期预览创建
 * - report_draft_generated：草稿生成成功
 * - report_draft_generation_failed：草稿生成失败
 * - report_budget_blocked：预算阻断
 * - report_draft_confirmed：草稿确认
 * - report_draft_returned：草稿退回
 * - report_draft_regenerated：草稿重新生成
 * - report_periodic_exported：导出创建
 *
 * 设计原则：
 * - 事件只包含低敏摘要，隐藏报表正文、完整 AI 草稿和敏感指标
 * - 目标引用指向审阅/详情页，点击后二次鉴权
 */

/** AI 周期报表活动事件类型 */
export type PeriodicActivityEvent =
  | 'report_periodic_preview_created'
  | 'report_draft_generated'
  | 'report_draft_generation_failed'
  | 'report_budget_blocked'
  | 'report_draft_confirmed'
  | 'report_draft_returned'
  | 'report_draft_regenerated'
  | 'report_periodic_exported'

/** 活动事件输入 */
export interface PeriodicActivityInput {
  organizationId: number
  projectId: number
  userId: number
  reportId: number
  versionId?: number
  templateId: string
  periodType: 'weekly' | 'monthly'
  periodRange: { fromDate: string; toDate: string }
  event: PeriodicActivityEvent
  errorCategory?: string
  exportFormat?: string
}

/** 活动事件输出（低敏） */
export interface PeriodicActivityRecord {
  type: 'report_activity'
  event: PeriodicActivityEvent
  /** 低敏摘要（不含正文/草稿/敏感指标） */
  summary: string
  targetType: string
  targetId: number
  /** 安全目标引用，点击后二次鉴权 */
  targetUrl: string | null
  metadata: Record<string, unknown>
  timestamp: string
}

/**
 * 构造周期报表活动事件记录。
 * 事件只包含低敏信息，隐藏报表正文、AI 草稿、prompt、模型输出和成本详情。
 */
export function buildPeriodicActivityEvent(input: PeriodicActivityInput): PeriodicActivityRecord {
  const periodLabel = input.periodType === 'weekly' ? '周报' : '月报'
  const baseMeta: Record<string, unknown> = {
    reportId: input.reportId,
    templateId: input.templateId,
    periodType: input.periodType,
    periodRange: input.periodRange,
  }
  if (input.versionId) baseMeta.versionId = input.versionId
  if (input.exportFormat) baseMeta.exportFormat = input.exportFormat

  switch (input.event) {
    case 'report_periodic_preview_created':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `创建了 AI ${periodLabel} 预览`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: `/projects/${input.projectId}/reports-v2/periodic/preview`,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_draft_generated':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 草稿生成成功，等待审核`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: input.versionId
          ? `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/review`
          : null,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_draft_generation_failed':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 草稿生成失败${input.errorCategory ? `（${input.errorCategory}）` : ''}`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: `/projects/${input.projectId}/reports-v2/periodic/jobs`,
        metadata: { ...baseMeta, errorCategory: input.errorCategory },
        timestamp: new Date().toISOString(),
      }

    case 'report_budget_blocked':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 因预算限制被阻止`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: `/projects/${input.projectId}/reports-v2/periodic/preview`,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_draft_confirmed':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 草稿已确认`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: input.versionId
          ? `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}`
          : null,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_draft_returned':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 草稿已退回`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: input.versionId
          ? `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/review`
          : null,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_draft_regenerated':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 草稿已重新生成`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: input.versionId
          ? `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/review`
          : null,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }

    case 'report_periodic_exported':
      return {
        type: 'report_activity',
        event: input.event,
        summary: `AI ${periodLabel} 导出完成（${input.exportFormat ?? '未知格式'}）`,
        targetType: 'report',
        targetId: input.reportId,
        targetUrl: input.versionId
          ? `/projects/${input.projectId}/reports-v2/periodic/versions/${input.versionId}/exports`
          : null,
        metadata: baseMeta,
        timestamp: new Date().toISOString(),
      }
  }
}
