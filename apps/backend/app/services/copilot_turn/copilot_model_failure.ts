/**
 * Copilot / AI 同事回答时的模型调用失败分类（2026-10-06）。
 *
 * 原先：
 * - 适配器把供应商错误（连不上、超时、中途断流、输出超长、重复循环）作为 `kind: 'error'` 的流块
 *   发出，回答流只取文本块，错误被静默丢弃；
 * - 其余异常一律归为 `retryable-service`，前端统一显示「暂时连不上 AI 模型，请确认组织已在
 *   AI 连接里配置可用模型」——供应商明明收到了请求，界面却说配置有问题。
 *
 * 现在按供应商返回的错误细分为稳定的分类键，并附低敏原因（只含分类与上游 HTTP 状态码，
 * 不含供应商原文、密钥或请求内容），前端据此给出对应说明。
 */

export type CopilotModelFailureKind =
  | 'model-timeout'
  | 'model-interrupted'
  | 'model-auth'
  | 'model-not-found'
  | 'rate-limit'
  | 'model-rejected'
  | 'model-output-limit'
  | 'model-loop'
  | 'model-error'

const REASONS: Record<CopilotModelFailureKind, string> = {
  'model-timeout': '模型供应商响应超时',
  'model-interrupted': '与模型供应商的连接中途断开',
  'model-auth': '模型供应商拒绝了密钥或权限',
  'model-not-found': '模型供应商找不到所选模型',
  'rate-limit': '模型供应商限流或额度不足',
  'model-rejected': '模型供应商拒绝了这次请求',
  'model-output-limit': '回答超过模型的输出长度上限',
  'model-loop': '模型输出陷入重复循环，已中止',
  'model-error': '模型供应商返回错误',
}

/** 回答流中的模型调用失败（带分类与低敏原因）。 */
export class CopilotModelCallError extends Error {
  readonly kind: CopilotModelFailureKind
  readonly reason: string

  constructor(kind: CopilotModelFailureKind, reason: string) {
    super(reason)
    this.name = 'CopilotModelCallError'
    this.kind = kind
    this.reason = reason
  }
}

/** 从错误信息开头取上游 HTTP 状态码（OpenAI / Anthropic SDK 的错误信息形如「429 Rate limit…」）。 */
function upstreamStatus(message: string, status?: unknown): number | null {
  if (typeof status === 'number' && status >= 100 && status < 600) return status
  const match = /^\s*(\d{3})\b/.exec(message)
  return match ? Number(match[1]) : null
}

/**
 * 按适配器的错误分类与供应商错误信息归类（纯函数，导出供单测）。
 * `message` 只用于判断，不会原样传给前端。
 */
export function classifyModelFailure(input: {
  errorKind?: string | null
  message?: string | null
  status?: unknown
}): CopilotModelCallError {
  const message = String(input.message ?? '')
  const lower = message.toLowerCase()
  const status = upstreamStatus(message, input.status)
  const make = (kind: CopilotModelFailureKind) =>
    new CopilotModelCallError(kind, status ? `${REASONS[kind]}（HTTP ${status}）` : REASONS[kind])

  if (input.errorKind === 'repetition_loop') return make('model-loop')
  if (
    status === 429 ||
    /rate.?limit|too many requests|quota|insufficient_quota|exceeded your current/.test(lower)
  )
    return make('rate-limit')
  if (
    status === 401 ||
    status === 403 ||
    /api.?key|unauthori[sz]ed|authentication|permission/.test(lower)
  )
    return make('model-auth')
  if (
    status === 404 ||
    /model.*(not.?found|does not exist|not exist|unsupported)|no such model/.test(lower)
  )
    return make('model-not-found')
  if (status !== null && status >= 500) return make('model-error')
  if (/timed? ?out|timeout|etimedout/.test(lower)) return make('model-timeout')
  if (input.errorKind === 'token_limit_exceeded') return make('model-output-limit')
  if (status !== null && status >= 400) return make('model-rejected')
  if (
    input.errorKind === 'sse_interrupted' ||
    /econnreset|socket hang up|connection|network|aborted|terminated/.test(lower)
  )
    return make('model-interrupted')
  return make('model-error')
}

/** 回答流程中抛出的任意异常 → 稳定分类键 + 低敏原因（turn-error 用）。 */
export function describeCopilotAnswerFailure(error: unknown): {
  errorKind: string
  degradedReason: string
} {
  if (error instanceof CopilotModelCallError) {
    return { errorKind: error.kind, degradedReason: error.reason }
  }
  const candidate = error as { rateLimitDecision?: unknown; message?: unknown; status?: unknown }
  // 平台自身的调用频率 / 预算守卫（resolveAdapter 抛出）
  if (candidate && typeof candidate === 'object' && candidate.rateLimitDecision) {
    return { errorKind: 'rate-limit', degradedReason: '超过平台的 AI 调用频率或额度限制' }
  }
  if (error instanceof Error) {
    const classified = classifyModelFailure({ message: error.message, status: candidate.status })
    // 认不出来的内部异常不冒充供应商问题
    if (
      classified.kind === 'model-error' &&
      upstreamStatus(error.message, candidate.status) === null
    ) {
      return { errorKind: 'retryable-service', degradedReason: '服务端处理这次回答时出错' }
    }
    return { errorKind: classified.kind, degradedReason: classified.reason }
  }
  return { errorKind: 'unknown', degradedReason: '未知错误' }
}
