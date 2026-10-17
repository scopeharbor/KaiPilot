/**
 * ProjectPredictionNotificationIntegration —— 预测低敏通知集成。
 *
 * 覆盖预测生成、失败、高严重度变化、AI 解释待审核、预算阻断和预测确认。
 * 通知 payload 低敏，不包含具体证据详情。
 *
 * v2-ai-risk-progress-prediction / design D10
 */
import { inject } from '@adonisjs/core'

export type PredictionNotificationEvent =
  | 'prediction_created'
  | 'prediction_failed'
  | 'high_severity_changed'
  | 'ai_explanation_pending'
  | 'budget_blocked'
  | 'prediction_confirmed'

export interface NotificationParams {
  organizationId: number
  projectId: number
  projectName?: string
  recipientId: number
  snapshotId?: number
  window?: number
  severityCount?: number
}

const EVENT_CONFIG: Record<PredictionNotificationEvent, { title: string; severity: string }> = {
  prediction_created: { title: '项目预测已生成', severity: 'info' },
  prediction_failed: { title: '项目预测生成失败', severity: 'warning' },
  high_severity_changed: { title: '项目预警级别变化', severity: 'warning' },
  ai_explanation_pending: { title: 'AI 预测解释待审核', severity: 'info' },
  budget_blocked: { title: 'AI 预算不足', severity: 'warning' },
  prediction_confirmed: { title: '项目预测已确认', severity: 'info' },
}

@inject()
export default class ProjectPredictionNotificationIntegration {
  async notify(event: PredictionNotificationEvent, params: NotificationParams): Promise<void> {
    const config = EVENT_CONFIG[event]
    const body = this.buildBody(event, params)
    const actionUrl = `/projects/${params.projectId}/predictions${params.snapshotId ? `?snapshot=${params.snapshotId}` : ''}`

    const { default: Notification } = await import('#models/notification')
    await Notification.create({
      organizationId: params.organizationId,
      projectId: params.projectId,
      recipientId: params.recipientId,
      type: 'prediction',
      title: config.title,
      body,
      actionUrl,
      severity: config.severity,
      readAt: null,
    })
  }

  private buildBody(event: PredictionNotificationEvent, params: NotificationParams): string {
    const name = params.projectName || ''
    switch (event) {
      case 'prediction_created':
        return `项目「${name}」${params.window}天预测快照已生成，共 ${params.severityCount ?? 0} 个信号`
      case 'prediction_failed':
        return `项目「${name}」预测生成失败，请稍后重试`
      case 'high_severity_changed':
        return `项目「${name}」存在 ${params.severityCount ?? 0} 个高严重度预警信号`
      case 'ai_explanation_pending':
        return `项目「${name}」的 AI 预测解释已完成，请审核`
      case 'budget_blocked':
        return `项目「${name}」AI 预算不足，预测解释生成被阻断`
      case 'prediction_confirmed':
        return `项目「${name}」${params.window}天预测已确认`
    }
  }
}
