/**
 * @aiproj/backend —— 阈值评价服务（tasks 7.1–7.5）。
 *
 * 基于健康摘要和已配置阈值，产生健康状态、稳定 reasonCode 和 runbook 引用。
 * 阈值越界只产生状态，不自动重启、重试、取消或 apply。
 *
 * @aiproj/backend
 */

import {
  type StreamHealthSummary,
  type ThresholdConfig,
  type ThresholdEvaluation,
  type ThresholdResult,
  type StreamingHealthState as HealthState,
  DEFAULT_THRESHOLDS,
} from '@aiproj/types/streaming-observability'

export interface ThresholdEvaluatorOptions {
  /** 覆盖默认阈值。若不提供，使用 DEFAULT_THRESHOLDS。 */
  thresholds?: ThresholdConfig[]
}

/**
 * 阈值评价器。
 * 检查健康摘要指标是否越界，产生评价结果。
 */
export class ThresholdEvaluator {
  readonly #thresholds: ThresholdConfig[]

  constructor(options?: ThresholdEvaluatorOptions) {
    this.#thresholds = options?.thresholds ?? [...DEFAULT_THRESHOLDS]
  }

  /** 获取当前阈值配置（可审查）。 */
  get thresholds(): readonly ThresholdConfig[] {
    return [...this.#thresholds]
  }

  /**
   * 对指定的健康摘要进行阈值评价。
   * 不修改任何业务状态。
   */
  evaluate(summary: StreamHealthSummary): ThresholdResult {
    const evaluations: ThresholdEvaluation[] = []

    for (const threshold of this.#thresholds) {
      if (threshold.streamKind !== summary.streamKind) continue

      const actualValue = this.#extractMetricValue(summary, threshold.metricPath)
      if (actualValue === undefined) continue

      const passed = this.#compareValues(actualValue, threshold.operator, threshold.value)

      evaluations.push({
        thresholdId: threshold.id,
        level: threshold.level,
        streamKind: threshold.streamKind,
        metricPath: threshold.metricPath,
        actualValue,
        thresholdValue: threshold.value,
        passed,
        reasonCode: passed ? 'HEARTBEAT_OK' : 'HEARTBEAT_STALE',
        runbookRef: threshold.runbookRef,
      })
    }

    const criticalFailures = evaluations.filter((e) => e.level === 'critical' && !e.passed)
    const warningFailures = evaluations.filter((e) => e.level === 'warning' && !e.passed)

    let overallState: HealthState = 'healthy'
    if (criticalFailures.length > 0) {
      overallState = 'critical'
    } else if (warningFailures.length > 0) {
      overallState = 'warning'
    }

    return {
      streamKind: summary.streamKind,
      evaluations,
      overallState,
    }
  }

  /**
   * 从 StreamHealthSummary 中提取指标值。
   * metricPath 格式如 "firstEventLatencyMs.p95Ms"。
   */
  #extractMetricValue(summary: StreamHealthSummary, metricPath: string): number | undefined {
    const parts = metricPath.split('.')
    let current: unknown = summary as unknown as Record<string, unknown>

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    if (typeof current === 'number') return current
    return undefined
  }

  #compareValues(actual: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt':
        return actual <= threshold
      case 'gte':
        return actual < threshold
      case 'lt':
        return actual >= threshold
      case 'lte':
        return actual > threshold
      default:
        return true
    }
  }

  /** 重置阈值配置为默认值。 */
  resetToDefaults(): void {
    this.#thresholds.length = 0
    this.#thresholds.push(...DEFAULT_THRESHOLDS)
  }
}
