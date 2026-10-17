/**
 * v3-ocr-provider-observability-cost-controls §4.7 — OCR 限流守卫。
 *
 * 使用本地滑动窗口实现 RPM/TPM 预检，不依赖 Redis。
 * 确定性：同一窗口同一输入产生相同结果。
 * 不做静默 provider 切换。
 */

import type { OcrRateLimitPreflightInput, OcrRateLimitPreflightResult } from '@aiproj/types'
import { checkOcrRateLimitCapacity, computeOcrRateLimitIdempotencyKey } from '@aiproj/types'
import OcrProviderAttempt from '#models/ocr_provider_attempt'
import { DateTime } from 'luxon'

const WINDOW_MS = 60_000 // 1 minute
const MAX_WAIT_MS = 30_000 // max bounded wait

interface WindowCounts {
  rpm: number
  tpm: number
}

export default class OcrRateLimitGuard {
  /**
   * Preflight: 检查当前窗口是否有 RPM/TPM 余量。
   * 使用最近 1 分钟的 attempt 记录来计数。
   */
  async preflight(input: OcrRateLimitPreflightInput): Promise<OcrRateLimitPreflightResult> {
    const rpmLimit = input.rpmLimit ?? null
    const tpmLimit = input.tpmLimit ?? null

    // 无限制 → 直接放行。
    // 必须按 null 判定而不是按真假值：限额 0 的含义是「一次调用都不许」，
    // 用 `!rpmLimit` 会把 0 当成「没设限额」而全部放行——把最严的配置变成最松的。
    if (rpmLimit === null && tpmLimit === null) {
      return {
        allowed: true,
        status: 'allowed',
        decisionId: null,
      }
    }

    const windowStart = DateTime.now().minus({ milliseconds: WINDOW_MS })
    const counts = await this.#countRecentAttempts(
      input.organizationId,
      input.provider,
      input.model,
      windowStart,
    )

    const estimatedTokens = input.estimatedTokens ?? 0
    const result = checkOcrRateLimitCapacity(
      counts.rpm,
      rpmLimit,
      counts.tpm + estimatedTokens,
      tpmLimit,
      estimatedTokens,
    )

    if (!result.allowed) {
      return {
        allowed: false,
        status: result.status,
        waitMs: result.status === 'blocked' ? MAX_WAIT_MS : null,
        decisionId: computeOcrRateLimitIdempotencyKey({
          organizationId: input.organizationId,
          projectId: input.projectId,
          ocrJobId: input.ocrJobId ?? null,
          provider: input.provider,
          model: input.model,
        }),
      }
    }

    return {
      allowed: true,
      status: 'allowed',
      decisionId: null,
    }
  }

  async #countRecentAttempts(
    organizationId: number,
    provider: string,
    model: string,
    windowStart: DateTime,
  ): Promise<WindowCounts> {
    const attempts = await OcrProviderAttempt.query()
      .where('organization_id', organizationId)
      .where('provider', provider)
      .where('model', model)
      .where('occurred_at', '>=', windowStart.toSQL()!)
      .whereNotIn('status', ['budget_blocked', 'skipped'])

    let rpm = 0
    let tpm = 0
    for (const a of attempts) {
      rpm++
      tpm += (a.inputTokens ?? 0) + (a.outputTokens ?? 0)
    }

    return { rpm, tpm }
  }
}

/** 暴露给测试：重置内存窗口。 */
export function clearOcrRateLimitWindowForTests() {
  // 当前实现基于 DB 查询，无需手动清内存。
  // 测试中通过清空 ocr_provider_attempts 表来重置。
}
