// apps/backend/app/services/bi_aggregation/adapters/index.ts
// v3-bi-data-aggregation-service §4：首批 adapter 索引与工厂。

export { BiTrendMetricsAdapter } from './bi_trend_adapter.js'
export { BiDashboardSummaryAdapter } from './bi_dashboard_adapter.js'
export { ReportV2DatasourceAdapter } from './report_v2_adapter.js'
export { FallbackBiAggregationAdapter, createFallbackAdapters } from './fallback_adapter.js'
