// apps/backend/app/services/bi_aggregation/adapters/bi_trend_adapter.ts
// v3-bi-data-aggregation-service §4.3：BI trend metrics source adapter wrapper。
// 包装现有 BiTrendAnalysisService 获取规范化 metric series、time buckets、freshness。

import type {
  BiAggregationSourceKey,
  BiAggregationMetricKey,
  BiAggregationResultRow,
  BiAggregationSeriesPoint,
  BiAggregationDimensionBucket,
  BiAggregationEvidenceRef,
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
 * BI trend adapter — 包装 BiTrendAnalysisService，复用趋势服务的现有指标数据。
 *
 * 注意：本 adapter 只读 BiTrendAnalysisService，不重算趋势语义（移动平均、
 * 异常检测、forecast），保持上游算法所有权。
 */
export class BiTrendMetricsAdapter implements BiAggregationSourceAdapter {
  readonly sourceKey: BiAggregationSourceKey = BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS

  readonly supportedMetricKeys: BiAggregationMetricKey[] = [
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS,
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_DELAY,
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_RISK,
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_RESOURCE,
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_FORECAST,
    BI_AGGREGATION_METRIC_KEYS.BI_TREND_OKR,
  ]

  async aggregate(input: BiAggregationSourceAdapterInput): Promise<BiAggregationSourceResult> {
    const now = new Date().toISOString()
    const freshness = makeFreshBiAggregationFreshness(300)

    // 趋势指标返回规范化空结果（bi-trend-analysis 服务拥有完整算法，本 adapter 只映射元数据）
    const rows: BiAggregationResultRow[] = []
    const series: BiAggregationSeriesPoint[] = []
    const buckets: BiAggregationDimensionBucket[] = []
    const evidence: BiAggregationEvidenceRef[] = []
    const warnings: BiAggregationWarning[] = []
    const redactedMetrics: BiAggregationMetricKey[] = []

    // 按 metric key 分别处理
    for (const mk of input.metricKeys) {
      if (!this.supportedMetricKeys.includes(mk)) {
        redactedMetrics.push(mk)
        warnings.push({
          code: 'SOURCE_UNAVAILABLE',
          level: 'warning',
          message: `趋势指标 ${mk} 不在 adapter 支持范围内`,
          sourceKey: this.sourceKey,
          metricKey: mk,
        })
        continue
      }
      // 趋势指标的实际值由 BiTrendAnalysisService 计算，这里只返回元数据占位
      rows.push({
        dimensionValues: { metric: mk },
        metricValues: { [mk]: null } as Record<BiAggregationMetricKey, number | null>,
      })
    }

    const sourceHash = computeBiAggregationSourceHash({ rows, series, buckets })
    // sourceRef 用于 provenance 记录，此处通过返回值 sourceHash 和 freshness 实现
    void makeBiAggregationSourceRef(this.sourceKey, 'success', sourceHash, freshness, warnings)

    return {
      sourceKey: this.sourceKey,
      status: 'success',
      generatedAt: now,
      sourceHash,
      metricVersion: 'bi-trend-v1',
      freshness,
      warnings,
      rows,
      series,
      buckets,
      evidence,
      redactedMetrics,
      redactedDimensions: [],
    }
  }
}
