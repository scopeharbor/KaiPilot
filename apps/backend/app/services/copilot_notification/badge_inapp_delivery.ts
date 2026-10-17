/**
 * v3-copilot-notification-routing — 徽章与站内通知投递（tasks 4.1-4.9）
 *
 * 职责：
 * - 4.1: 面板徽章未读计数消费收件箱既有计数端点，不另算
 * - 4.3: 站内通知走既有 notification_service，不新建通知实体
 * - 4.5: 通知点击进入建议确认流程，而非直接执行任何动作
 * - 4.7: 投递不改变收件箱条目状态（已读只由用户查看产生）
 * - 4.9: 徽章实时更新按 realtime_broadcaster 接线
 *
 * 设计纪律：
 * - 复用既有 notification_service，不新建实体
 * - 通知 actionUrl 指向建议确认流程，不直接执行
 * - 投递后收件箱条目仍为未读
 */

import type NotificationService from '#services/notification_service'
import type RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import type { ChannelDeliveryResult } from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity } from '@aiproj/types'
import { INBOX_PROBLEM_KIND_LABELS, INBOX_SEVERITY_LABELS } from '@aiproj/types'

export interface BadgeInAppDeliveryInput {
  /** 收件箱条目 ID */
  entryId: string
  /** 组织 ID */
  organizationId: number
  /** 用户 ID */
  recipientId: number
  /** 项目 ID */
  projectId: number
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 严重度 */
  severity: InboxSeverity
  /** 未读计数 */
  unreadCount: number
}

export class BadgeInAppDelivery {
  constructor(
    private notificationService: NotificationService,
    private realtimeBroadcaster: RealtimeBroadcaster,
  ) {}

  /**
   * 4.1 + 4.3: 投递徽章和站内通知。
   *
   * @param input 投递输入
   * @param badgeResult 徽章通道投递结果
   * @param inAppResult 站内通知通道投递结果
   */
  async deliver(
    input: BadgeInAppDeliveryInput,
    badgeResult: ChannelDeliveryResult,
    inAppResult: ChannelDeliveryResult,
  ): Promise<void> {
    // 4.1: 徽章 —— 消费收件箱既有计数端点，不另算
    // 徽章更新通过实时广播触发前端重新查询
    if (badgeResult.success) {
      this.broadcastBadgeUpdate(input.recipientId, input.unreadCount)
    }

    // 4.3: 站内通知 —— 走既有 notification_service，不新建通知实体
    if (inAppResult.success) {
      await this.createInAppNotification(input)
    }
  }

  /**
   * 4.9: 徽章实时更新 —— 通过 realtime_broadcaster 推送未读计数变化。
   */
  private broadcastBadgeUpdate(userId: number, unreadCount: number): void {
    this.realtimeBroadcaster.broadcastToUser(userId, {
      type: 'badge:updated' as any,
      projectId: 0,
      entityId: 0,
      actorId: userId,
      occurredAt: new Date().toISOString(),
      metadata: { unreadCount },
    })
  }

  /**
   * 4.3: 创建站内通知 —— 复用 notification_service，不新建实体。
   *
   * 4.5: 通知 actionUrl 指向建议确认流程，不直接执行。
   */
  private async createInAppNotification(input: BadgeInAppDeliveryInput): Promise<void> {
    const kindLabel = INBOX_PROBLEM_KIND_LABELS[input.problemKind] ?? input.problemKind
    const severityLabel = INBOX_SEVERITY_LABELS[input.severity] ?? input.severity

    // 4.5: 通知点击进入建议确认流程
    const actionUrl = `/copilot-suggestion-inbox/${input.entryId}?action=confirm`

    await this.notificationService.createForUser({
      organizationId: input.organizationId,
      recipientId: input.recipientId,
      type: 'general',
      title: `新建议：${kindLabel}`,
      body: `严重度 ${severityLabel} — 点击查看详情并确认`,
      severity: input.severity as any,
      projectId: input.projectId,
      targetType: 'copilot_suggestion_inbox',
      targetId: Number.parseInt(input.entryId.replace(/\D/g, ''), 10) || 0,
      actionUrl,
      idempotencyKey: `inbox-delivery-${input.entryId}`,
      metadata: {
        event: 'suggestion_delivered',
        entryId: input.entryId,
        problemKind: input.problemKind,
      },
    })
  }

  /**
   * 4.7: 投递不改变收件箱条目状态。
   * 此方法为空操作 —— 已读只由用户查看产生。
   */
  markEntryRead(): void {
    // 空操作：投递不改变条目状态
  }
}
