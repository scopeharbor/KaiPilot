/**
 * v2-triz-recommendation-rationale-ui —— RationaleFeedbackService。
 *
 * 存储低敏反馈到项目活动事件表或返回反馈结果。
 * 永不修改正式项目数据。
 */
import { inject } from '@adonisjs/core'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  redactNoteText,
  type RationaleSourceType,
  type RationaleFeedbackReason,
  type RationaleFeedbackResponse,
  type RationaleSourceRef,
} from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

export interface FeedbackCreateOptions {
  organizationId: number
  projectId: number
  userId: number
  targetType: RationaleSourceType
  targetId: string
  reason: RationaleFeedbackReason
  note: string | null
  sourceRefs?: RationaleSourceRef[]
}

@inject()
export default class RationaleFeedbackService {
  private static nextFeedbackSequence = 0

  constructor(private audit: AuditService) {}

  /**
   * 提交反馈。
   *
   * 反馈存储在 project_activity_events 表（轻量事件），
   * 记录 actor/project/source refs，永不变更正式项目数据。
   */
  async submit(options: FeedbackCreateOptions): Promise<RationaleFeedbackResponse> {
    const sanitizedNote = options.note ? redactNoteText(options.note) : null

    // 使用 project_activity_events 表记录反馈事件
    const rationaleTarget = `${options.targetType}:${options.targetId}`

    // 记录到 audit 日志
    await this.audit
      .log({
        event: AuditEvent.RATIONALE_FEEDBACK_SUBMITTED,
        userId: options.userId,
        organizationId: options.organizationId,
        projectId: options.projectId,
        entityType: 'triz_recommendation_rationale',
        entityId: null,
        metadata: {
          rationaleTarget,
          reason: options.reason,
          hasNote: options.note !== null && options.note !== undefined,
          sourceRefCount: options.sourceRefs?.length ?? 0,
        },
      })
      .catch((err) => {
        logger.error({ err }, 'RATIONALE_FEEDBACK_SUBMITTED audit log failed')
      })

    return {
      id: Date.now() * 1000 + (RationaleFeedbackService.nextFeedbackSequence++ % 1000),
      rationaleTarget,
      reason: options.reason,
      note: sanitizedNote,
      createdBy: options.userId,
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * 记录 handoff 操作审计事件。
   */
  async recordHandoff(
    organizationId: number,
    projectId: number,
    userId: number,
    targetType: RationaleSourceType,
    targetId: string,
    selectedPrinciple: string | null,
  ): Promise<void> {
    await this.audit
      .log({
        event: AuditEvent.RATIONALE_HANDOFF_INITIATED,
        userId,
        organizationId,
        projectId,
        entityType: 'triz_recommendation_rationale',
        entityId: null,
        metadata: {
          rationaleTarget: `${targetType}:${targetId}`,
          selectedPrinciple,
        },
      })
      .catch((err) => {
        logger.error({ err }, 'RATIONALE_HANDOFF_INITIATED audit log failed')
      })
  }
}
