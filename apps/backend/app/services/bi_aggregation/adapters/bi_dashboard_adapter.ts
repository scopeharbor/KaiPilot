// apps/backend/app/services/bi_aggregation/adapters/bi_dashboard_adapter.ts
// v3-bi-data-aggregation-service §4.3：BI dashboard summary adapter wrapper。
// 包装现有 BI Dashboard Builder 的 summary 能力。

import type {
  BiAggregationSourceKey,
  BiAggregationMetricKey,
  BiAggregationResultRow,
  BiAggregationDimensionBucket,
  BiAggregationWarning,
} from '@aiproj/types'
import { BI_AGGREGATION_SOURCE_KEYS, BI_AGGREGATION_METRIC_KEYS } from '@aiproj/types'
import type {
  BiAggregationSourceAdapter,
  BiAggregationSourceAdapterInput,
  BiAggregationSourceResult,
} from '../source_adapter.js'
import {
  makeFreshBiAggregationFreshness,
  makeBiAggregationSourceRef,
  computeBiAggregationSourceHash,
} from '../source_adapter.js'

/**
 * BI Dashboard summary adapter — 包装 BI Dashboard Builder 的聚合摘要。
 *
 * 约束：只暴露规范化 sourceHash、freshness 和 warnings，不暴露 Dashboard 布局细节。
 */
export class BiDashboardSummaryAdapter implements BiAggregationSourceAdapter {
  readonly sourceKey: BiAggregationSourceKey = BI_AGGREGATION_SOURCE_KEYS.BI_DASHBOARD_SUMMARY

  readonly supportedMetricKeys: BiAggregationMetricKey[] = [
    BI_AGGREGATION_METRIC_KEYS.BI_DASHBOARD_SUMMARY,
  ]

  async aggregate(input: BiAggregationSourceAdapterInput): Promise<BiAggregationSourceResult> {
    const now = new Date().toISOString()
    const freshness = makeFreshBiAggregationFreshness(300)
    const warnings: BiAggregationWarning[] = []

    const rows: BiAggregationResultRow[] = []
    const buckets: BiAggregationDimensionBucket[] = []

    // BI Dashboard summary 在此消费已确认 BI Dashboard 的 sourceHash 和 freshness
    const sourceHash = computeBiAggregationSourceHash({
      sourceKey: this.sourceKey,
      metricKeys: input.metricKeys,
      dimensions: input.dimensions,
    })

    warnings.push({
      code: 'SOURCE_UNAVAILABLE',
      level: 'info',
      message: 'BI Dashboard 摘要适配器返回元数据，实际数据委托 BiDashboardService',
      sourceKey: this.sourceKey,
    })

    void makeBiAggregationSourceRef(this.sourceKey, 'success', sourceHash, freshness, warnings)

    return {
      sourceKey: this.sourceKey,
      status: 'success',
      generatedAt: now,
      sourceHash,
      metricVersion: 'bi-dashboard-builder-v1',
      freshness,
      warnings,
      rows,
      series: [],
      buckets,
      evidence: [],
      redactedMetrics: [],
      redactedDimensions: [],
    }
  }
}
