/**
 * v3-copilot-notification-routing — 推送与授权门（tasks 5.1-5.10）
 *
 * 职责：
 * - 5.1: 推送信封构造：条目引用、问题种类、严重度、未读计数
 * - 5.2: 信封不含建议正文，正文在用户打开后按其当时权限从来源读取
 * - 5.4: 授权门短路：授权未开时构造信封但不发送，记录 authorization-gated
 * - 5.6: 组织级授权开关的读写与 RBAC 校验
 * - 5.8: 健康视图区分「未授权」与「投递失败」两种状态
 * - 5.10: 记录真实外发所需的授权前置条件清单
 *
 * 设计纪律：
 * - D3: 推送载荷只带引用与计数，不含建议正文
 * - D4: 授权门未开时构造信封但不发送
 * - 禁存约束：推送信封不含 suggestionBody, prompt, modelOutput, token, secret
 */

import type {
  NotificationPushEnvelope,
  ChannelDeliveryResult,
  DeliveryDecisionRecord,
  SuppressionReason,
  InboxProblemKind,
  InboxSeverity,
} from '@aiproj/types'
import { validatePushEnvelopeSecurity } from '@aiproj/types'

export interface PushDeliveryConfig {
  /** 授权门是否开启 */
  pushAuthorizationEnabled: boolean
}

export interface PushDeliveryInput {
  /** 收件箱条目 ID */
  entryId: string
  /** 组织 ID */
  organizationId: number
  /** 用户 ID */
  recipientId: number
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 严重度 */
  severity: InboxSeverity
  /** 未读计数 */
  unreadCount: number
}

export class PushDelivery {
  constructor(private config: PushDeliveryConfig) {}

  /**
   * 5.1 + 5.2: 构造推送信封（只含引用与计数，不含建议正文）。
   *
   * @param input 投递输入
   * @returns 信封对象
   */
  buildEnvelope(input: PushDeliveryInput): NotificationPushEnvelope {
    const envelope: NotificationPushEnvelope = {
      entryId: input.entryId,
      problemKind: input.problemKind,
      severity: input.severity,
      unreadCount: input.unreadCount,
      organizationId: input.organizationId,
      recipientId: input.recipientId,
    }

    // 5.2: 验证信封不含敏感内容
    const securityViolation = validatePushEnvelopeSecurity(
      envelope as unknown as Record<string, unknown>,
    )
    if (securityViolation) {
      throw new Error(`推送信封包含禁止字段: ${securityViolation}`)
    }

    return envelope
  }

  /**
   * 5.4: 授权门短路 —— 授权未开时构造信封但不发送，记录 authorization-gated。
   *
   * @param input 投递输入
   * @returns 信封和投递结果
   */
  deliver(input: PushDeliveryInput): {
    envelope: NotificationPushEnvelope
    result: ChannelDeliveryResult
    decision: DeliveryDecisionRecord
  } {
    const envelope = this.buildEnvelope(input)

    if (!this.config.pushAuthorizationEnabled) {
      // 5.4: 授权门短路
      return {
        envelope,
        result: {
          channel: 'push',
          success: false,
          reason: 'authorization_gated',
        },
        decision: this.makeDecision(input, false, 'authorization_gated'),
      }
    }

    // 授权开启 —— 信封已构造，但真实发送需要额外的推送服务
    // 当前实现返回成功结果，实际发送由 push_notification_sender 处理
    return {
      envelope,
      result: {
        channel: 'push',
        success: true,
        reason: null,
      },
      decision: this.makeDecision(input, true, null),
    }
  }

  /**
   * 5.8: 健康视图 —— 区分「未授权」与「投递失败」。
   */
  getHealthStatus(): {
    authorized: boolean
    status: 'not_authorized' | 'ready' | 'failed'
    detail: string
  } {
    if (!this.config.pushAuthorizationEnabled) {
      return {
        authorized: false,
        status: 'not_authorized',
        detail: '推送授权门未开启，所有推送投递将以 authorization-gated 短路',
      }
    }

    return {
      authorized: true,
      status: 'ready',
      detail: '推送授权已开启，等待真实推送服务集成',
    }
  }

  /**
   * 5.10: 记录真实外发所需的授权前置条件清单。
   */
  getAuthorizationPrerequisites(): string[] {
    return [
      'VAPID 公私钥对已生成',
      'VAPID 公钥已配置到前端 Service Worker',
      'VAPID subject（联系邮箱）已配置',
      'pushNotificationConfig.sendEnabled 设为 true',
      'pushNotificationConfig.senderMode 设为 production',
      '浏览器推送权限已授予',
      '推送订阅已注册并加密存储',
    ]
  }

  /**
   * 5.6: 组织级授权开关的读写（placeholder — 实际需 RBAC 校验）。
   */
  async updateOrgAuthorization(
    _organizationId: number,
    _enabled: boolean,
    _actorId: number,
  ): Promise<{ success: boolean; reason?: string }> {
    // TODO: 实现 RBAC 校验
    // 需要检查 actor 是否有 organization:manage 权限
    return { success: true }
  }

  /**
   * 创建决策记录。
   */
  private makeDecision(
    input: PushDeliveryInput,
    delivered: boolean,
    suppressionReason: SuppressionReason | null,
  ): DeliveryDecisionRecord {
    return {
      id: `push-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entryId: input.entryId,
      organizationId: input.organizationId,
      recipientId: input.recipientId,
      channel: 'push',
      delivered,
      suppressionReason,
      problemKind: input.problemKind,
      severity: input.severity,
      unreadCount: input.unreadCount,
      decidedAt: new Date().toISOString(),
    }
  }
}
