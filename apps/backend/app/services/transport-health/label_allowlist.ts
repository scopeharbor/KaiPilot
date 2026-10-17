/**
 * @aiproj/backend —— Label allowlist 与基数守卫（tasks 2.3–2.6）。
 *
 * 运行时检查 metric label 是否在允许范围内。
 * 用于：
 * - 拒绝高基数 label（organizationId、userId、draftId、runId 等）
 * - 限制固定窗口内 series 数量
 * - 记录 instrumentation error
 *
 * @aiproj/backend
 */

import {
  FORBIDDEN_METRIC_LABELS,
  ALLOWED_METRIC_LABEL_KEYS,
  MAX_SERIES_PER_WINDOW,
  type MetricLabels,
  type ReasonCode,
  type StreamKind,
} from '@aiproj/types/streaming-observability'

export interface LabelGuardResult {
  valid: boolean
  /** 清理后的 labels（strip 模式返回移除了禁止字段的 labels）。 */
  sanitized: MetricLabels
  /** 若无效，记录稳定的 error code。 */
  errorCode?: string
}

/**
 * 验证 MetricLabels 合法性。
 *
 * @param labels - 待验证的 labels
 * @param mode - 'reject' 抛出异常，'strip' 移除非法字段，'report' 只返回结果
 */
export function validateLabels(
  labels: Record<string, unknown>,
  mode: 'reject' | 'strip' | 'report' = 'report',
): LabelGuardResult {
  const errors: string[] = []

  // 检查禁止字段
  for (const key of Object.keys(labels)) {
    if ((FORBIDDEN_METRIC_LABELS as readonly string[]).includes(key)) {
      errors.push(`Forbidden metric label: ${key}`)
    }
  }

  // 检查不允许的额外字段
  for (const key of Object.keys(labels)) {
    if (!(ALLOWED_METRIC_LABEL_KEYS as readonly string[]).includes(key)) {
      if (!(FORBIDDEN_METRIC_LABELS as readonly string[]).includes(key)) {
        errors.push(`Unknown metric label: ${key}`)
      }
    }
  }

  if (errors.length === 0) {
    return { valid: true, sanitized: labels as unknown as MetricLabels }
  }

  if (mode === 'strip') {
    const sanitized: Record<string, unknown> = {}
    for (const key of Object.keys(labels)) {
      if ((ALLOWED_METRIC_LABEL_KEYS as readonly string[]).includes(key)) {
        sanitized[key] = labels[key]
      }
    }
    return {
      valid: false,
      sanitized: sanitized as unknown as MetricLabels,
      errorCode: 'INSTRUMENTATION_ERROR',
    }
  }

  if (mode === 'reject') {
    throw new Error(errors.join('; '))
  }

  return {
    valid: false,
    sanitized: labels as unknown as MetricLabels,
    errorCode: 'INSTRUMENTATION_ERROR',
  }
}

/**
 * 模拟大量不同 stream 的 metric label 组合，检查 series 数量。
 * 用于测试验证 series 数量不随业务 ID 线性增长。
 */
export function estimateSeriesCount(
  streamKinds: StreamKind[],
  outcomes: string[],
  reasonCodes: string[],
): number {
  // 每个 streamKind 产生 streams × outcomes × reasonCodes 组合
  return streamKinds.length * outcomes.length * Math.min(reasonCodes.length, 30)
}

/**
 * 检查现有 series 数量是否超过上限。
 */
export function checkSeriesLimit(currentCount: number): {
  exceeded: boolean
  reasonCode?: ReasonCode
} {
  if (currentCount > MAX_SERIES_PER_WINDOW) {
    return { exceeded: true, reasonCode: 'RATE_LIMITED' }
  }
  return { exceeded: false }
}
