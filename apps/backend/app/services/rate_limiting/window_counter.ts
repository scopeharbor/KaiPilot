/**
 * v3-global-ai-rate-limiting §4.1–4.5 — 窗口计数器。
 *
 * 从统一账本推导窗口计数（RPM 与 TPM），复用账本窗口索引。
 * 设计约束：
 * - 以统一账本为唯一计数来源，不引入第二计数源；
 * - 计数查询有界扫描，禁止无界全表扫描；
 * - 窗口边界语义：滚动窗口（1 分钟）。
 */

import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { RATE_LIMIT_WINDOW_MS } from '@aiproj/types'
import { DateTime } from 'luxon'

export interface WindowCounts {
  rpm: number
  tpm: number
}

export interface WindowCounterInput {
  organizationId: number
  connectionId: number | null
  modelId: number | null
  windowStart?: DateTime // 可选，默认为当前时间前 1 分钟
}

export default class WindowCounter {
  /**
   * 从统一账本推导窗口计数（RPM 与 TPM）。
   * 复用账本窗口索引 `(organization_id, connection_id, model_id, created_at)`。
   */
  async getCounts(input: WindowCounterInput): Promise<WindowCounts> {
    const windowStart =
      input.windowStart ?? DateTime.now().minus({ milliseconds: RATE_LIMIT_WINDOW_MS })

    // 使用账本窗口索引进行有界扫描
    const attempts = await UnifiedAiInvocationLedger.query()
      .where('organization_id', input.organizationId)
      .where('connection_id', input.connectionId ?? 0) // null 时用 0 匹配
      .where('model_id', input.modelId ?? 0) // null 时用 0 匹配
      .where('created_at', '>=', windowStart.toSQL()!)
      .whereNotIn('status', ['aborted', 'failed']) // 排除失败和中止的 attempt

    let rpm = 0
    let tpm = 0
    for (const attempt of attempts) {
      rpm++
      tpm += (attempt.usageInputTokens ?? 0) + (attempt.usageOutputTokens ?? 0)
    }

    return { rpm, tpm }
  }

  /**
   * 获取窗口边界（用于决策记录）。
   */
  getWindowBounds(now: DateTime = DateTime.now()): { start: DateTime; end: DateTime } {
    const end = now
    const start = now.minus({ milliseconds: RATE_LIMIT_WINDOW_MS })
    return { start, end }
  }
}
