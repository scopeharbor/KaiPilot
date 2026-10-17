/**
 * v3-copilot-notification-routing — 通道路由服务（tasks 3.1-3.8）
 *
 * 职责：
 * - 按偏好与问题种类确定目标通道集合
 * - 组织级偏好为上限，个人级只能在上限内更严格
 * - 路由确定性：相同输入 → 相同输出
 * - 本层不做频次判定（疲劳控制归上游触发层）
 * - 每次路由都产出决策记录，含未投递的通道与原因
 *
 * 设计纪律（D1-D7）：
 * - D2：本层不做频次判定
 * - D7：组织级设上限，个人级在上限内自选
 */

import type {
  DeliveryChannel,
  DeliveryChannelPreference,
  DeliveryPreference,
  DeliveryDecisionRecord,
  DeliveryResultSummary,
  ChannelDeliveryResult,
  SuppressionReason,
  InboxProblemKind,
} from '@aiproj/types'
import { DELIVERY_CHANNELS, DELIVERY_CHANNEL_STRENGTH } from '@aiproj/types'

export interface DeliveryRouterConfig {
  /** 授权门是否开启（默认 false） */
  pushAuthorizationEnabled: boolean
}

export class DeliveryRouter {
  constructor(private config: DeliveryRouterConfig) {}

  /**
   * 3.1: 按偏好与问题种类确定目标通道集合。
   *
   * @param problemKind 问题种类
   * @param organizationPref 组织级偏好
   * @param personalPref 个人级偏好（可选）
   * @returns 投递结果摘要
   */
  route(
    entryId: string,
    problemKind: InboxProblemKind,
    organizationPref: DeliveryPreference,
    personalPref?: DeliveryPreference,
  ): DeliveryResultSummary {
    const results: ChannelDeliveryResult[] = []
    const decisions: DeliveryDecisionRecord[] = []

    // 3.2: 合并偏好（组织级为上限，个人级只能更严格）
    const mergedPref = this.mergePreferences(problemKind, organizationPref, personalPref)

    // 按强度序遍历通道（显式排序：此前只是巧合依赖 DELIVERY_CHANNELS 的声明顺序）
    const channelsByStrength = [...DELIVERY_CHANNELS].sort(
      (a, b) => DELIVERY_CHANNEL_STRENGTH[a] - DELIVERY_CHANNEL_STRENGTH[b],
    )
    for (const channel of channelsByStrength) {
      const channelPref = mergedPref[channel]
      const orgChannelPref = organizationPref.preferences[problemKind]?.[channel]

      if (!channelPref?.enabled) {
        // 通道被关闭
        const reason: SuppressionReason =
          orgChannelPref?.enabled === false ? 'organization_disabled' : 'channel_disabled'

        results.push({ channel, success: false, reason })
        decisions.push(
          this.makeDecision(
            entryId,
            organizationPref.ownerId,
            personalPref?.ownerId ?? organizationPref.ownerId,
            channel,
            false,
            reason,
            problemKind,
          ),
        )
        continue
      }

      // 推送通道需要授权门检查
      if (channel === 'push' && !this.config.pushAuthorizationEnabled) {
        results.push({ channel, success: false, reason: 'authorization_gated' })
        decisions.push(
          this.makeDecision(
            entryId,
            organizationPref.ownerId,
            personalPref?.ownerId ?? organizationPref.ownerId,
            channel,
            false,
            'authorization_gated',
            problemKind,
          ),
        )
        continue
      }

      // 通道启用且授权通过
      results.push({ channel, success: true, reason: null })
      decisions.push(
        this.makeDecision(
          entryId,
          organizationPref.ownerId,
          personalPref?.ownerId ?? organizationPref.ownerId,
          channel,
          true,
          null,
          problemKind,
        ),
      )
    }

    return { entryId, results, decisions }
  }

  /**
   * 3.2: 合并偏好（组织级为上限，个人级只能更严格）。
   */
  private mergePreferences(
    problemKind: InboxProblemKind,
    orgPref: DeliveryPreference,
    personalPref?: DeliveryPreference,
  ): DeliveryChannelPreference {
    const orgChannels: Partial<DeliveryChannelPreference> = orgPref.preferences[problemKind] ?? {}
    const personalChannels: Partial<DeliveryChannelPreference> =
      personalPref?.preferences[problemKind] ?? {}

    const merged = {} as DeliveryChannelPreference

    for (const channel of DELIVERY_CHANNELS) {
      const orgEnabled = orgChannels[channel]?.enabled ?? false
      const personalEnabled = personalChannels[channel]?.enabled ?? orgEnabled

      // 3.2: 组织级为上限，个人级只能更严格
      merged[channel] = { enabled: orgEnabled && personalEnabled }
    }

    return merged
  }

  /**
   * 3.8: 每次路由都产出决策记录。
   */
  private makeDecision(
    entryId: string,
    organizationId: number,
    recipientId: number,
    channel: DeliveryChannel,
    delivered: boolean,
    suppressionReason: SuppressionReason | null,
    problemKind: string,
  ): DeliveryDecisionRecord {
    return {
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entryId,
      organizationId,
      recipientId,
      channel,
      delivered,
      suppressionReason,
      problemKind,
      severity: 'info', // 低敏默认值
      unreadCount: 0, // 由调用方提供
      decidedAt: new Date().toISOString(),
    }
  }
}
