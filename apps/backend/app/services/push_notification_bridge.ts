/**
 * v2-5-pwa-web-push-notifications -- PushNotificationBridge 通知桥接实现（task 6.1）。
 *
 * 从通知创建到推送发送意图的窄桥接。
 * 使用现有 NotificationService 作为 truth source，受 feature flag 控制。
 * 桥接调用是 best-effort：不阻塞站内通知创建。
 */
import type PushEnvelopeBuilder from '#services/push_envelope_builder'
import type PushNotificationSender from '#services/push_notification_sender'
import type PwaPushSubscriptionService from '#services/pwa_push_subscription_service'
import type AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'

/**
 * PushNotificationBridge —— 从通知创建到推送发送意图的窄桥接（design D4）。
 *
 * 职责：
 * 1. 通知创建后，检查是否可推送
 * 2. 构建低敏 push envelope
 * 3. 查找接收人活跃订阅
 * 4. 发送推送（best-effort）
 * 5. 记录低敏审计
 *
 * 设计原则：
 * - 桥接调用是 best-effort，不阻塞站内通知创建
 * - feature flag 关闭时跳过发送
 * - 发送失败不影响通知事实
 */
export default class PushNotificationBridge {
  constructor(
    private envelopeBuilder: PushEnvelopeBuilder,
    private sender: PushNotificationSender,
    private subscriptionService: PwaPushSubscriptionService,
    private audit: AuditService,
  ) {}

  /**
   * 通知创建后桥接到推送发送。
   * best-effort：内部异常不抛出，不阻塞调用方。
   */
  async onNotificationCreated(data: {
    id: number
    type: string
    severity?: string
    organizationId: number
    recipientId: number
    actionUrl?: string | null
  }): Promise<void> {
    try {
      // 1. 检查功能是否启用
      if (!this.subscriptionService.isEnabled()) {
        this.audit.log({
          event: AuditEvent.PWA_WEB_PUSH_SEND_DISABLED,
          severity: 'info',
          userId: data.recipientId,
          organizationId: data.organizationId,
          entityType: 'notification',
          entityId: data.id,
          metadata: { reason: 'feature_disabled' },
        })
        return
      }

      // 2. 构建 push envelope
      const envelope = this.envelopeBuilder.buildFromData({
        id: data.id,
        type: data.type,
        severity: data.severity,
        createdAt: undefined as any, // 运行时由实际 DateTime 提供
        actionUrl: data.actionUrl,
      })

      if (!envelope) {
        // 不可推送类型，静默跳过
        return
      }

      // 3. 查找接收人活跃订阅
      const subscriptions = await this.subscriptionService.findActiveByRecipient(
        data.organizationId,
        data.recipientId,
      )

      if (subscriptions.length === 0) {
        return // 无活跃订阅，跳过
      }

      // 4. 发送推送（best-effort）
      for (const sub of subscriptions) {
        try {
          const endpoint = this.subscriptionService.decryptEndpoint(sub)
          const p256dh = this.subscriptionService.decryptP256dh(sub)
          const auth = this.subscriptionService.decryptAuth(sub)

          const attempt = await this.sender.send(envelope, endpoint, p256dh, auth)

          // 5. 低敏审计
          this.audit.log({
            event: AuditEvent.PWA_WEB_PUSH_SEND_ATTEMPT,
            severity: 'info',
            userId: data.recipientId,
            organizationId: data.organizationId,
            entityType: 'push_subscription',
            entityId: sub.id,
            metadata: {
              notificationId: envelope.notificationId,
              result: attempt.result,
              mode: attempt.mode,
            },
          })

          // 6. 处理失效 endpoint
          if (attempt.result === 'invalid_endpoint') {
            await this.subscriptionService.invalidateEndpoint(
              data.organizationId,
              data.recipientId,
              endpoint,
            )
          }
        } catch {
          // 单条订阅发送失败不影响其他订阅
        }
      }
    } catch {
      // 桥接失败不抛出，不阻塞调用方
    }
  }
}
