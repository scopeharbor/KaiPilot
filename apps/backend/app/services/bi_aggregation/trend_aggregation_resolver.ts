// apps/backend/app/services/bi_aggregation/trend_aggregation_resolver.ts
// v3-bi-data-aggregation-service §6.1：BI 趋势分析 aggregation-backed source resolver。
// 使趋势查询可通过 BI aggregation registry 获取规范化 metric series、time buckets、
// freshness、warnings 和 provenance。

import type {
  BiAggregationMetricKey,
  BiAggregationSourceKey,
  BiAggregationWarning,
} from '@aiproj/types'
import { BI_AGGREGATION_METRIC_KEYS } from '@aiproj/types'
import type { BiAggregationRegistry } from './registry.js'

/**
 * 趋势指标 → BI aggregation metric key 映射。
 * 将 BiTrendMetricKey 映射到 BI_AGGREGATION_METRIC_KEYS。
 */
const TREND_TO_AGGREGATION_METRIC: Record<string, BiAggregationMetricKey> = {
  project_progress: BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS,
  schedule_delay_pressure: BI_AGGREGATION_METRIC_KEYS.BI_TREND_DELAY,
  risk_pressure: BI_AGGREGATION_METRIC_KEYS.BI_TREND_RISK,
  resource_pressure: BI_AGGREGATION_METRIC_KEYS.BI_TREND_RESOURCE,
  forecast_demand_pressure: BI_AGGREGATION_METRIC_KEYS.BI_TREND_FORECAST,
  okr_progress: BI_AGGREGATION_METRIC_KEYS.BI_TREND_OKR,
}

export interface AggregationResolvedTrendSource {
  resolved: boolean
  aggregationMetricKey?: BiAggregationMetricKey
  aggregationSourceKey?: BiAggregationSourceKey
  reason?: string
  freshness?: string
  warnings?: BiAggregationWarning[]
}

/**
 * 趋势指标聚合解析器。
 *
 * 职责：
 *   - 检查趋势 metric key 是否已在 BI aggregation registry 注册
 *   - 若已注册，返回对应的 aggregation metric/source key 和 freshness
 *   - 若未注册，返回 unresolved 状态和 reason
 *
 * 红线：
 *   - 不重算趋势语义（移动平均、异常检测、forecast）
 *   - 趋势算法所有权保留在 bi-trend-analysis
 */
export class TrendAggregationResolver {
  constructor(private readonly registry: BiAggregationRegistry) {}

  /**
   * 尝试将趋势指标解析为 BI aggregation metric。
   */
  resolveTrendMetric(trendMetricKey: string): AggregationResolvedTrendSource {
    const aggMetricKey = TREND_TO_AGGREGATION_METRIC[trendMetricKey]

    if (!aggMetricKey) {
      return {
        resolved: false,
        reason: `趋势指标 "${trendMetricKey}" 不在 BI aggregation metric 注册表中`,
      }
    }

    const metricDef = this.registry.getMetric(aggMetricKey)
    if (!metricDef) {
      return {
        resolved: false,
        reason: `BI aggregation metric "${aggMetricKey}" 未注册`,
      }
    }

    return {
      resolved: true,
      aggregationMetricKey: aggMetricKey,
      aggregationSourceKey: metricDef.sourceKey,
      freshness: 'pending', // freshness 由实际聚合查询决定
    }
  }

  /**
   * 批量解析趋势指标。
   */
  resolveTrendMetrics(trendMetricKeys: string[]): Map<string, AggregationResolvedTrendSource> {
    const result = new Map<string, AggregationResolvedTrendSource>()
    for (const key of trendMetricKeys) {
      result.set(key, this.resolveTrendMetric(key))
    }
    return result
  }

  /**
   * 返回可在 BI aggregation 中使用的 metric key 集合。
   */
  resolvableAggregationMetricKeys(trendMetricKeys: string[]): BiAggregationMetricKey[] {
    const keys: BiAggregationMetricKey[] = []
    for (const key of trendMetricKeys) {
      const resolved = this.resolveTrendMetric(key)
      if (resolved.resolved && resolved.aggregationMetricKey) {
        keys.push(resolved.aggregationMetricKey)
      }
    }
    return keys
  }
}
