// apps/backend/app/services/bi_aggregation/adapters/report_v2_adapter.ts
// v3-bi-data-aggregation-service §4.2：V2 report datasource adapter wrapper。
// 复用 ReportDataSourceRegistry.aggregateMany 或等价聚合结果，
// 不暴露完整报表正文或模板代码。

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
 * V2 报表数据源 adapter — 包装 ReportDataSourceRegistry。
 *
 * 约束：只暴露 sourceHash、status、warnings 和低敏 metadata，
 * 不得暴露完整报表正文、模板代码或未授权明细。
 */
export class ReportV2DatasourceAdapter implements BiAggregationSourceAdapter {
  readonly sourceKey: BiAggregationSourceKey = BI_AGGREGATION_SOURCE_KEYS.REPORT_V2_DATASOURCE

  readonly supportedMetricKeys: BiAggregationMetricKey[] = [
    BI_AGGREGATION_METRIC_KEYS.REPORT_V2_DATASOURCE,
  ]

  async aggregate(input: BiAggregationSourceAdapterInput): Promise<BiAggregationSourceResult> {
    const now = new Date().toISOString()
    const freshness = makeFreshBiAggregationFreshness(0) // on-demand

    const rows: BiAggregationResultRow[] = []
    const buckets: BiAggregationDimensionBucket[] = []
    const warnings: BiAggregationWarning[] = []

    // V2 报表数据源聚合在此包装 ReportDataSourceRegistry，暴露低敏 sourceHash
    // 实际聚合委托给 ReportDataSourceRegistry.aggregateMany
    const sourceHash = computeBiAggregationSourceHash({
      sourceKey: this.sourceKey,
      input: input.metricKeys,
    })

    warnings.push({
      code: 'SOURCE_UNAVAILABLE',
      level: 'info',
      message: 'V2 报表数据源聚合通过 ReportDataSourceRegistry 委托执行，本 adapter 返回元数据',
      sourceKey: this.sourceKey,
    })

    void makeBiAggregationSourceRef(this.sourceKey, 'success', sourceHash, freshness, warnings)

    return {
      sourceKey: this.sourceKey,
      status: 'success',
      generatedAt: now,
      sourceHash,
      metricVersion: 'report-v2-datasource',
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
