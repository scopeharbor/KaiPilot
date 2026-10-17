/**
 * v3-global-ai-rate-limiting §6.1–6.2 — 限流错误。
 *
 * 实现超限返回明确限流错误与确定性重试建议。
 * 禁止静默排队与静默丢弃。
 */

export class RateLimitError extends Error {
  public readonly decision: 'throttle' | 'reject'
  public readonly retryAfterSeconds: number | null
  public readonly triggeringLayer: string | null
  public readonly decisionId: string | null

  constructor(params: {
    decision: 'throttle' | 'reject'
    retryAfterSeconds: number | null
    triggeringLayer: string | null
    decisionId: string | null
    message?: string
  }) {
    const message = params.message ?? `Rate limit exceeded: ${params.decision}`
    super(message)
    this.name = 'RateLimitError'
    this.decision = params.decision
    this.retryAfterSeconds = params.retryAfterSeconds
    this.triggeringLayer = params.triggeringLayer
    this.decisionId = params.decisionId
  }

  /**
   * 转换为 API 响应格式。
   */
  toApiResponse(): {
    error: {
      code: string
      message: string
      details?: {
        decision: string
        retryAfterSeconds: number | null
        triggeringLayer: string | null
        decisionId: string | null
      }
    }
  } {
    return {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: this.message,
        details: {
          decision: this.decision,
          retryAfterSeconds: this.retryAfterSeconds,
          triggeringLayer: this.triggeringLayer,
          decisionId: this.decisionId,
        },
      },
    }
  }
}

/**
 * 检查错误是否为限流错误。
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}
