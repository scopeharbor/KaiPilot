import Risk from '#models/risk'
import AuditService, { AuditEvent } from '#services/audit_service'
import RiskHistoryService from '#services/risk_history_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export interface ReviewInput {
  conclusion: string
  nextAction: string
  nextReviewAt?: string | null
  notes?: string | null
}

/**
 * RiskReviewService — 风险复查记录管理。
 *
 * 复查记录不改变风险生命周期状态。
 * 复查仅更新 lastReviewAt，不隐式关/开风险。
 */
@inject()
export default class RiskReviewService {
  constructor(
    private audit: AuditService,
    private riskHistory: RiskHistoryService,
  ) {}

  /**
   * 提交风险复查记录。
   * 更新 lastReviewAt 和可选的 nextReviewAt，不自动改变风险状态。
   */
  async review(
    organizationId: number,
    projectId: number,
    riskId: number,
    input: ReviewInput,
    actorUserId: number,
  ): Promise<Risk> {
    const risk = await Risk.query()
      .where('id', riskId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!risk) throw new ResourceNotFoundException('风险不存在')

    // 更新复查时间
    risk.lastReviewAt = DateTime.now()
    if (input.nextReviewAt) {
      risk.nextReviewAt = DateTime.fromISO(input.nextReviewAt)
    }
    risk.updatedBy = actorUserId
    await risk.save()

    // 写风险历史
    await this.riskHistory.record({
      organizationId,
      projectId,
      riskId: risk.id,
      eventType: 'reviewed',
      actorId: actorUserId,
      summary: {
        conclusion: input.conclusion,
        nextAction: input.nextAction,
        hasNextReview: !!input.nextReviewAt,
      },
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.RISK_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: { action: 'reviewed', conclusion: input.conclusion },
    })

    return risk
  }
}
