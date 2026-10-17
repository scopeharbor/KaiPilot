/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 投递统计服务（4.1 P0, design D3/D4/D5）。
 *
 * 聚合 delivery ledger 表数据，按组织隔离，返回低敏聚合统计。
 * 日期窗口 bounded（最多 90 天，默认 30 天）。
 * 不暴露 payload body、完整响应体、敏感请求 header、secret 明文/密文、token、API key、
 * auth header、prompt、模型输出。
 *
 * feature-off 时返回 deterministic 不可用态（design D5）。
 */
import { DateTime } from 'luxon'
import OutgoingWebhookDeliveryEvent from '#models/outgoing_webhook_delivery_event'
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import type {
  OutgoingWebhookStatsDto,
  OutgoingWebhookStatsByStatus,
  OutgoingWebhookStatsByFailureCategory,
  OutgoingWebhookStatsUnavailableDto,
} from '@aiproj/types'
import type { OutgoingWebhookDeliveryStatus, OutgoingWebhookFailureCategory } from '@aiproj/types'

/** 默认统计窗口：30 天。 */
const DEFAULT_STATS_WINDOW_DAYS = 30
/** 最大统计窗口：90 天。 */
const MAX_STATS_WINDOW_DAYS = 90

/** feature-off 门控（design D5）：默认关闭。 */
export function webhookStatsEnabled(): boolean {
  const raw = process.env.OUTGOING_WEBHOOK_STATS_ENABLED
  if (raw === undefined) return false
  return raw === 'true' || raw === '1'
}

export class OutgoingWebhookStatsService {
  /**
   * 获取组织级投递统计。
   * @param organizationId 组织 ID
   * @param startDate 可选起始日期（ISO string）
   * @param endDate 可选结束日期（ISO string）
   * @returns 统计 DTO 或不可用态
   */
  async getStats(
    organizationId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<OutgoingWebhookStatsDto | OutgoingWebhookStatsUnavailableDto> {
    if (!webhookStatsEnabled()) {
      return { available: false, reason: 'feature_disabled' }
    }

    // 解析日期窗口
    const end = endDate ? DateTime.fromISO(endDate) : DateTime.now()
    const start = startDate
      ? DateTime.fromISO(startDate)
      : end.minus({ days: DEFAULT_STATS_WINDOW_DAYS })

    // 边界校验
    const diffDays = Math.abs(end.diff(start, 'days').days)
    if (diffDays > MAX_STATS_WINDOW_DAYS) {
      return { available: false, reason: 'feature_disabled' }
    }

    const startStr = start.toISO()!
    const endStr = end.toISO()!

    // 查询投递事件（组织隔离）
    const events = await OutgoingWebhookDeliveryEvent.query()
      .where('organization_id', organizationId)
      .where('created_at', '>=', startStr)
      .where('created_at', '<=', endStr)
      .orderBy('created_at', 'desc')

    if (events.length === 0) {
      return {
        available: false,
        reason: 'no_data',
      }
    }

    // 按状态统计
    const byStatus: OutgoingWebhookStatsByStatus = {
      pending: 0,
      in_progress: 0,
      success: 0,
      failed: 0,
      paused: 0,
    }
    let totalRetries = 0
    const failureCategoryCounts: Record<string, number> = {
      timeout: 0,
      network: 0,
      rate_limited: 0,
      server_error: 0,
      client_error: 0,
      signature: 0,
      config: 0,
      disabled: 0,
      exhausted: 0,
      unknown: 0,
    }

    let lastDeliveryAt: string | null = null
    let nextRetryAt: string | null = null

    for (const event of events) {
      const status = event.status as OutgoingWebhookDeliveryStatus
      if (byStatus[status] !== undefined) {
        byStatus[status]++
      }
      totalRetries += Math.max(0, event.attemptCount - 1)

      // 记录最近投递时间
      if (
        event.lastAttemptAt &&
        (!lastDeliveryAt || event.lastAttemptAt.toISO()! > lastDeliveryAt)
      ) {
        lastDeliveryAt = event.lastAttemptAt.toISO()!
      }

      // 记录下次重试时间
      if (event.nextAttemptAt && (!nextRetryAt || event.nextAttemptAt.toISO()! < nextRetryAt)) {
        nextRetryAt = event.nextAttemptAt.toISO()!
      }

      // 终态失败分类
      if (status === 'failed' && event.failureCategory) {
        const cat = event.failureCategory as OutgoingWebhookFailureCategory
        if (failureCategoryCounts[cat] !== undefined) {
          failureCategoryCounts[cat]++
        }
      }
    }

    // 查询活跃订阅数
    const activeSubscriptionCount = await OutgoingWebhookSubscription.query()
      .where('organization_id', organizationId)
      .where('status', 'active')
      .count('* as count')
      .first()

    // 查询模板使用计数（从订阅 metadata 中获取）
    // 目前模板使用计数为 0，将来订阅模型支持 templateId 后可以查询
    const templateUsageCount: Record<string, number> = {}

    const total = events.length
    const successCount = byStatus.success
    const failedCount = byStatus.failed

    return {
      startDate: start.toISODate()!,
      endDate: end.toISODate()!,
      totalDeliveries: total,
      byStatus,
      successRate: total > 0 ? successCount / total : 0,
      failureRate: total > 0 ? failedCount / total : 0,
      totalRetries,
      byFailureCategory: failureCategoryCounts as unknown as OutgoingWebhookStatsByFailureCategory,
      lastDeliveryAt,
      nextRetryAt,
      activeSubscriptionCount: Number((activeSubscriptionCount as any)?.$extras?.count ?? 0),
      templateUsageCount,
    }
  }
}
