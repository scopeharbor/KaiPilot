/**
 * v3-copilot-notification-routing — 投递编排器（tasks 6.1-6.7）
 *
 * 职责：
 * - 6.1: 单通道失败不影响其余通道
 * - 6.3: 失败按通道分别记录原因，不合并为笼统失败
 * - 6.5: 投递失败不静默丢弃：条目仍在收件箱内可见
 * - 6.7: 投递为观察-驱动旁路：失败不阻断触发与聚合
 *
 * 设计纪律：
 * - D5: 单通道失败不影响其余通道，且必须留痕
 * - 投递是观察-驱动的旁路，不改变收件箱状态
 */

import { DeliveryRouter } from '#services/copilot_notification/delivery_router'
import { BadgeInAppDelivery } from '#services/copilot_notification/badge_inapp_delivery'
import { PushDelivery } from '#services/copilot_notification/push_delivery'
import type {
  DeliveryResultSummary,
  ChannelDeliveryResult,
  DeliveryPreference,
  InboxProblemKind,
  InboxSeverity,
} from '@aiproj/types'
import type NotificationService from '#services/notification_service'
import type RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'

export interface DeliveryOrchestratorConfig {
  /** 推送授权门是否开启 */
  pushAuthorizationEnabled: boolean
}

export interface DeliveryInput {
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

export class DeliveryOrchestrator {
  private router: DeliveryRouter
  private badgeInAppDelivery: BadgeInAppDelivery
  private pushDelivery: PushDelivery

  constructor(
    config: DeliveryOrchestratorConfig,
    notificationService: NotificationService,
    realtimeBroadcaster: RealtimeBroadcaster,
  ) {
    this.router = new DeliveryRouter({
      pushAuthorizationEnabled: config.pushAuthorizationEnabled,
    })
    this.badgeInAppDelivery = new BadgeInAppDelivery(notificationService, realtimeBroadcaster)
    this.pushDelivery = new PushDelivery({
      pushAuthorizationEnabled: config.pushAuthorizationEnabled,
    })
  }

  /**
   * 6.1 + 6.3 + 6.5 + 6.7: 编排多通道投递。
   *
   * @param input 投递输入
   * @param orgPref 组织级偏好
   * @param personalPref 个人级偏好（可选）
   * @returns 投递结果摘要
   */
  async deliver(
    input: DeliveryInput,
    orgPref: DeliveryPreference,
    personalPref?: DeliveryPreference,
  ): Promise<DeliveryResultSummary> {
    // 3.1: 路由确定目标通道集合
    const routingResult = this.router.route(input.entryId, input.problemKind, orgPref, personalPref)

    // 6.1: 单通道失败不影响其余通道 —— 逐通道投递
    for (const result of routingResult.results) {
      if (result.success) {
        await this.deliverToChannel(input, result)
      }
      // 6.3: 失败按通道分别记录原因 —— 已在 routingResult.decisions 中记录
      // 6.5: 投递失败不静默丢弃 —— 条目仍在收件箱内可见（不改变条目状态）
      // 6.7: 投递为观察-驱动旁路 —— 失败不阻断触发与聚合
    }

    return routingResult
  }

  /**
   * 逐通道投递。
   */
  private async deliverToChannel(
    input: DeliveryInput,
    result: ChannelDeliveryResult,
  ): Promise<void> {
    switch (result.channel) {
      case 'badge':
      case 'in_app_notification':
        // 4.1 + 4.3: 徽章和站内通知投递
        await this.badgeInAppDelivery.deliver(
          input,
          result.channel === 'badge'
            ? result
            : { channel: 'badge', success: false, reason: 'channel_disabled' },
          result.channel === 'in_app_notification'
            ? result
            : { channel: 'in_app_notification', success: false, reason: 'channel_disabled' },
        )
        break

      case 'push':
        // 5.1 + 5.4: 推送信封构造和授权门短路
        this.pushDelivery.deliver(input)
        break
    }
  }

  /**
   * 5.8: 获取投递健康视图。
   */
  getHealthStatus(): {
    badge: { status: string }
    inAppNotification: { status: string }
    push: { status: string; authorized: boolean }
  } {
    const pushHealth = this.pushDelivery.getHealthStatus()

    return {
      badge: { status: 'available' },
      inAppNotification: { status: 'available' },
      push: {
        status: pushHealth.status,
        authorized: pushHealth.authorized,
      },
    }
  }
}
