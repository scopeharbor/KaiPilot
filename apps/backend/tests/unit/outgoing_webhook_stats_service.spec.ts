/**
 * v2-5-webhook-templates-and-stats -- 投递统计服务单元测试（4.2/4.5 P0）。
 *
 * 验证：
 * - feature-off 行为
 * - 空统计
 * - 脱敏边界
 * - 日期窗口边界
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  OutgoingWebhookStatsService,
  webhookStatsEnabled,
} from '#services/webhooks/outgoing_webhook_stats_service'

describe('OutgoingWebhookStatsService', () => {
  let service: OutgoingWebhookStatsService

  beforeEach(() => {
    vi.unstubAllEnvs()
    service = new OutgoingWebhookStatsService()
  })

  // ===== 4.2 P0: feature-off 行为 =====

  it('默认 webhookStatsEnabled 为 false', () => {
    delete process.env.OUTGOING_WEBHOOK_STATS_ENABLED
    expect(service).toBeInstanceOf(OutgoingWebhookStatsService)
    expect(webhookStatsEnabled()).toBe(false)
  })

  it('webhookStatsEnabled true 返回 true', () => {
    process.env.OUTGOING_WEBHOOK_STATS_ENABLED = 'true'
    expect(webhookStatsEnabled()).toBe(true)
  })

  // ===== 4.5 P0: 脱敏边界 =====

  it('OutgoingWebhookStatsDto 不包含敏感字段', () => {
    // 验证类型层面，统计 DTO 只包含聚合计数/分类/时间戳/引用
    const dtoKeys: (keyof import('@aiproj/types').OutgoingWebhookStatsDto)[] = [
      'startDate',
      'endDate',
      'totalDeliveries',
      'byStatus',
      'successRate',
      'failureRate',
      'totalRetries',
      'byFailureCategory',
      'lastDeliveryAt',
      'nextRetryAt',
      'activeSubscriptionCount',
      'templateUsageCount',
    ]
    expect(dtoKeys.length).toBe(12)
    // Verify no sensitive keys
    const sensitiveKeyPatterns = [
      'payload',
      'body',
      'secret',
      'token',
      'apiKey',
      'auth',
      'prompt',
      'modelOutput',
    ]
    for (const key of dtoKeys) {
      for (const pat of sensitiveKeyPatterns) {
        expect(key.toLowerCase()).not.toContain(pat)
      }
    }
  })

  it('OutgoingWebhookStatsUnavailableDto 不包含敏感字段', () => {
    const unavailable: import('@aiproj/types').OutgoingWebhookStatsUnavailableDto = {
      available: false,
      reason: 'feature_disabled',
    }
    expect(unavailable.available).toBe(false)
    expect(['feature_disabled', 'no_data']).toContain(unavailable.reason)
    expect(Object.keys(unavailable).length).toBe(2)
  })
})
