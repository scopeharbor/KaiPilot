import pwaWebPushConfig from '#config/pwa_web_push'
import type { PushNotificationEnvelope, PushSenderMode, PushSendAttempt } from '@aiproj/types'
import { DateTime } from 'luxon'

/**
 * PushNotificationSender —— 推送发送器（design D3）。
 *
 * 使用适配器模式，支持 fixture（默认）和 production 两种模式。
 * - fixture 模式：记录发送意图，不产生真实网络流量，返回确定性结果。
 * - production 模式：需要完整 VAPID 凭证且 sendEnabled=true。
 *
 * 默认 fixture 模式，确保不产生未授权外发。
 */
export default class PushNotificationSender {
  /**
   * 发送推送通知。
   * 在 fixture 模式下只记录不发送；在 production 模式下尝试真实发送。
   */
  async send(
    envelope: PushNotificationEnvelope,
    _endpoint: string,
    _p256dh: string,
    _auth: string,
  ): Promise<PushSendAttempt> {
    if (!pwaWebPushConfig.enabled || !pwaWebPushConfig.sendEnabled) {
      return {
        notificationId: envelope.notificationId,
        result: 'feature_disabled',
        mode: 'fixture',
        createdAt: DateTime.now().toISO()!,
      }
    }

    if (pwaWebPushConfig.senderMode === 'fixture') {
      // Fixture 模式：记录发送意图，返回确定性成功
      return {
        notificationId: envelope.notificationId,
        result: 'fixture_recorded',
        mode: 'fixture',
        createdAt: DateTime.now().toISO()!,
      }
    }

    // Production 模式：实际发送（需要完整 VAPID 凭证）
    if (!pwaWebPushConfig.canSendProduction) {
      return {
        notificationId: envelope.notificationId,
        result: 'feature_disabled',
        mode: 'fixture',
        createdAt: DateTime.now().toISO()!,
      }
    }

    try {
      // TODO: 当用户明确授权后，在此处实现真实 web-push 库调用
      // const pushResult = await webpush.sendNotification(subscription, JSON.stringify(envelope))
      // 暂时返回 fixture 结果
      return {
        notificationId: envelope.notificationId,
        result: 'fixture_recorded',
        mode: 'production',
        createdAt: DateTime.now().toISO()!,
      }
    } catch (error) {
      return {
        notificationId: envelope.notificationId,
        result: 'failed',
        mode: 'production',
        createdAt: DateTime.now().toISO()!,
      }
    }
  }

  /**
   * 获取当前发送器模式。
   */
  getMode(): PushSenderMode {
    return pwaWebPushConfig.senderMode
  }

  /**
   * 检查是否可发送。
   */
  canSend(): boolean {
    return pwaWebPushConfig.enabled && pwaWebPushConfig.sendEnabled
  }
}
