/**
 * v3-unified-ai-feedback-ledger §8.1 — 反馈记账 recorder。
 *
 * 失败姿态（§8.1）：
 * - 反馈记账失败不得阻断业务决策路径
 * - 反馈记账失败不得改变终态
 * - 反馈记账失败不得丢弃用户决策
 *
 * 用户决策由业务路径持久化，本账本只是其观测投影。
 * 降级不丢数据——决策仍存在业务表中，投影可重新计算。
 */

import { DateTime } from 'luxon'
import type { UnifiedFeedbackEvent } from '@aiproj/types'
import { feedbackHasForbiddenKeys } from '@aiproj/types'
import UnifiedAiFeedbackEvent from '#models/unified_ai_feedback_event'

// ===========================================================================
// §8.1 降级策略
// ===========================================================================

export interface RecordFeedbackResult {
  success: boolean
  eventId?: number
  error?: string
  degraded: boolean
}

/**
 * 记录反馈事件。失败时降级——不抛错、不阻断调用方。
 *
 * 红线：
 * - 如果事件包含禁止内容键，拒绝写入
 * - 幂等键重复时返回已有事件 ID
 * - 写入失败返回 degraded=true，不抛错
 */
export async function recordFeedbackEvent(
  event: UnifiedFeedbackEvent,
): Promise<RecordFeedbackResult> {
  try {
    // 检查禁止内容键（§2.12 sanitizer）
    const forbiddenKeys = feedbackHasForbiddenKeys(event as unknown as Record<string, unknown>)
    if (forbiddenKeys) {
      return {
        success: false,
        error: 'Event contains forbidden content keys',
        degraded: true,
      }
    }

    // 幂等检查
    const existing = await UnifiedAiFeedbackEvent.query()
      .where('idempotency_key', event.idempotencyKey)
      .first()

    if (existing) {
      return {
        success: true,
        eventId: existing.id,
        degraded: false,
      }
    }

    // 写入
    const created = await UnifiedAiFeedbackEvent.create({
      organizationId: event.organizationId,
      projectId: event.projectId,
      artifactKind: event.artifactKind,
      artifactId: event.artifactId,
      capabilitySurface: event.capabilitySurface,
      feedbackType: event.feedbackType,
      rejectionReason: event.rejectionReason,
      modificationFingerprint: event.modificationFingerprint,
      note: event.note,
      proposedContentHash: event.proposedContentHash,
      finalContentHash: event.finalContentHash,
      actorId: event.actorId,
      idempotencyKey: event.idempotencyKey,
      sourceEndpoint: event.sourceEndpoint,
      sourceRef: event.sourceRef,
      deduplicationKey: event.deduplicationKey,
      occurredAt: DateTime.fromISO(event.occurredAt),
    })

    return {
      success: true,
      eventId: created.id,
      degraded: false,
    }
  } catch (error: any) {
    // §8.1 降级：失败不抛错，返回 degraded
    return {
      success: false,
      error: error?.message ?? 'Unknown error recording feedback event',
      degraded: true,
    }
  }
}
