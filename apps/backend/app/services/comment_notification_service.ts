import Comment from '#models/comment'
import NotificationService from '#services/notification_service'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import logger from '@adonisjs/core/services/logger'
import { RealtimeEvents, type RealtimeEventEnvelope } from '#types/realtime_events'
import { inject } from '@adonisjs/core'

/**
 * 评论通知生成服务（v2-collaboration-comments-mentions）。
 *
 * 职责（4.1-4.3）：
 * - 评论回复通知：@回复你的评论
 * - @提及通知：有人在你可见的评论中 @你
 * - 评论解决通知：你的评论线程被解决/重新打开
 * - 通知低敏 payload：仅包含摘要和引用，不暴露正文
 * - 排除当前操作者、自提及通知和重复参与者
 * - 通知点击目标二次鉴权（actionUrl 跳转后由 REST 校验）
 *
 * 通知类型（扩展既有 notification_type CHECK 约束兼容映射）：
 * - 'comment_added' → 回复通知
 * - 'general' → 提及和解决通知（使用 metadata.event 区分）
 */
@inject()
export default class CommentNotificationService {
  constructor(private notificationService: NotificationService) {}

  /**
   * 4.2：创建评论回复通知。
   *
   * @param comment 刚创建的回复评论
   * @param parentAuthorId 父评论作者（被通知人）
   * @param actorUserId 当前操作者（被排除）
   * @param organizationId 组织
   * @param projectId 项目
   * @param entityType 实体类型
   * @param entityId 实体 ID
   */
  async notifyReply(
    comment: Comment,
    parentAuthorId: number,
    actorUserId: number,
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
  ): Promise<void> {
    // 排除操作者（自己回复自己）
    if (parentAuthorId === actorUserId) return

    try {
      const bodyExcerpt = this.excerpt(comment.body ?? '')

      await this.notificationService.createForUser({
        organizationId,
        recipientId: parentAuthorId,
        type: 'comment_added',
        title: '有人回复了你的评论',
        body: bodyExcerpt,
        severity: 'info',
        projectId,
        targetType: entityType,
        targetId: entityId,
        actionUrl: this.buildActionUrl(projectId, entityType, entityId, comment.id),
        metadata: {
          event: 'comment_reply',
          commentId: comment.id,
          replierId: actorUserId,
          entityType,
          entityId,
        },
      })

      // 实时提示
      this.broadcastToUser(parentAuthorId, {
        type: RealtimeEvents.NOTIFICATION_ARRIVED,
        projectId,
        entityId: comment.id,
        actorId: actorUserId,
        occurredAt: new Date().toISOString(),
        metadata: { notificationType: 'comment_reply' },
      })
    } catch (error) {
      logger.error({ err: error, commentId: comment.id }, '评论回复通知发送失败')
    }
  }

  /**
   * 4.2：创建 @提及通知。
   *
   * @param comment 刚创建的评论
   * @param mentionedUserIds 被提及用户 ID 列表
   * @param actorUserId 当前操作者（排除自提及）
   * @param organizationId 组织
   * @param projectId 项目
   * @param entityType 实体类型
   * @param entityId 实体 ID
   */
  async notifyMentions(
    comment: Comment,
    mentionedUserIds: number[],
    actorUserId: number,
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
  ): Promise<void> {
    const bodyExcerpt = this.excerpt(comment.body ?? '')
    const uniqueIds = [...new Set(mentionedUserIds)]

    for (const mentionedUserId of uniqueIds) {
      // 排除操作者（自提及不通知）
      if (mentionedUserId === actorUserId) continue

      try {
        await this.notificationService.createForUser({
          organizationId,
          recipientId: mentionedUserId,
          type: 'general',
          title: '有人在评论中提到了你',
          body: bodyExcerpt,
          severity: 'info',
          projectId,
          targetType: entityType,
          targetId: entityId,
          actionUrl: this.buildActionUrl(projectId, entityType, entityId, comment.id),
          metadata: {
            event: 'comment_mention',
            commentId: comment.id,
            mentionerId: actorUserId,
            entityType,
            entityId,
          },
        })

        // 实时提示
        this.broadcastToUser(mentionedUserId, {
          type: RealtimeEvents.NOTIFICATION_ARRIVED,
          projectId,
          entityId: comment.id,
          actorId: actorUserId,
          occurredAt: new Date().toISOString(),
          metadata: { notificationType: 'comment_mention' },
        })
      } catch (error) {
        logger.warn({ err: error, mentionedUserId, commentId: comment.id }, '@提及通知发送失败')
      }
    }
  }

  /**
   * 4.2：创建评论解决/重新打开通知（通知根评论作者）。
   */
  async notifyResolveChange(
    comment: Comment,
    isResolved: boolean,
    actorUserId: number,
  ): Promise<void> {
    try {
      // 排除操作者（自己解决自己的评论）
      if (comment.authorId === actorUserId) return

      await this.notificationService.createForUser({
        organizationId: comment.organizationId,
        recipientId: comment.authorId,
        type: 'general',
        title: isResolved ? '你的评论线程已被解决' : '你的评论线程已重新打开',
        body: null,
        severity: isResolved ? 'info' : 'warning',
        projectId: comment.projectId,
        targetType: comment.entityType ?? 'project',
        targetId: comment.entityId ?? comment.projectId,
        actionUrl: this.buildActionUrl(
          comment.projectId,
          comment.entityType ?? 'project',
          comment.entityId ?? comment.projectId,
          comment.id,
        ),
        metadata: {
          event: isResolved ? 'comment_resolved' : 'comment_reopened',
          commentId: comment.id,
          resolverId: actorUserId,
          entityType: comment.entityType,
          entityId: comment.entityId,
        },
      })

      // 实时提示
      this.broadcastToUser(comment.authorId, {
        type: RealtimeEvents.NOTIFICATION_ARRIVED,
        projectId: comment.projectId,
        entityId: comment.id,
        actorId: actorUserId,
        occurredAt: new Date().toISOString(),
        metadata: { notificationType: isResolved ? 'comment_resolved' : 'comment_reopened' },
      })
    } catch (error) {
      logger.warn({ err: error, commentId: comment.id }, '评论状态变更通知发送失败')
    }
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  /**
   * 生成低敏正文摘要（最长 200 字符）。
   */
  private excerpt(body: string, maxLength: number = 200): string {
    const trimmed = body.trim()
    if (trimmed.length <= maxLength) return trimmed
    return trimmed.slice(0, maxLength).trimEnd() + '…'
  }

  /**
   * 构建通知点击跳转链接。
   * 前端收到后须二次鉴权，失权后隐藏敏感信息。
   */
  private buildActionUrl(
    projectId: number,
    entityType: string,
    entityId: number,
    commentId: number,
  ): string {
    return `/projects/${projectId}/${entityType}s/${entityId}?commentId=${commentId}`
  }

  /**
   * 向用户个人频道广播低敏提示。
   */
  private broadcastToUser(userId: number, event: RealtimeEventEnvelope): void {
    try {
      const broadcaster = new RealtimeBroadcaster()
      broadcaster.broadcastToUser(userId, event)
    } catch (error) {
      logger.warn({ err: error, userId }, '评论广播失败')
    }
  }
}
