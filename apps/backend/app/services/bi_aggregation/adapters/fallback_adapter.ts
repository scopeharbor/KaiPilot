// apps/backend/app/services/bi_aggregation/adapters/fallback_adapter.ts
// v3-bi-data-aggregation-service §4.4：为 organization/PMO/resource/OKR/risk/project health
// 摘要 adapter 提供安全 fallback，未实现或无权限时返回 unavailable/forbidden warning。
//
// 本文件实现 P0 要求的 fallback adapter：不伪造数据，不调用未实现服务。

import type { BiAggregationSourceKey, BiAggregationMetricKey } from '@aiproj/types'
import { BI_AGGREGATION_SOURCE_KEYS } from '@aiproj/types'
import type {
  BiAggregationSourceAdapter,
  BiAggregationSourceAdapterInput,
  BiAggregationSourceResult,
} from '../source_adapter.js'
import {
  makeUnavailableSourceResult,
  makeForbiddenSourceResult,
  makeEmptySourceResult,
} from '../source_adapter.js'

/**
 * Fallback adapter — 为未实现的服务返回 UNIMPLEMENTED/SOURCE_UNAVAILABLE。
 * 不伪造数据，符合 spec §4.4 "未实现时返回 unavailable/forbidden warning"。
 */
export class FallbackBiAggregationAdapter implements BiAggregationSourceAdapter {
  readonly sourceKey: BiAggregationSourceKey
  readonly supportedMetricKeys: BiAggregationMetricKey[]
  private readonly reason: string
  private readonly mode: 'unavailable' | 'forbidden' | 'empty'

  constructor(
    sourceKey: BiAggregationSourceKey,
    supportedMetricKeys: BiAggregationMetricKey[],
    opts?: { reason?: string; mode?: 'unavailable' | 'forbidden' | 'empty' },
  ) {
    this.sourceKey = sourceKey
    this.supportedMetricKeys = supportedMetricKeys
    this.reason = opts?.reason ?? `${sourceKey} 适配器尚未实现`
    this.mode = opts?.mode ?? 'unavailable'
  }

  async aggregate(_input: BiAggregationSourceAdapterInput): Promise<BiAggregationSourceResult> {
    switch (this.mode) {
      case 'forbidden':
        return makeForbiddenSourceResult(this.sourceKey, this.reason)
      case 'empty':
        return makeEmptySourceResult(this.sourceKey)
      default:
        return makeUnavailableSourceResult(this.sourceKey, this.reason)
    }
  }
}

/**
 * 创建所有 fallback adapters，覆盖 organization/PMO/resource/OKR/risk/project health。
 */
export function createFallbackAdapters(): FallbackBiAggregationAdapter[] {
  return [
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.ORGANIZATION_DASHBOARD,
      ['organization_dashboard_summary' as BiAggregationMetricKey],
      { reason: '组织 Dashboard 聚合适配器待接入', mode: 'unavailable' },
    ),
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.PMO_DASHBOARD,
      ['pmo_dashboard_summary' as BiAggregationMetricKey],
      { reason: 'PMO Dashboard 聚合适配器待接入', mode: 'unavailable' },
    ),
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.RESOURCE_POOL,
      ['resource_summary' as BiAggregationMetricKey],
      { reason: '资源池聚合适配器待接入', mode: 'unavailable' },
    ),
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.OKR_DASHBOARD,
      ['okr_summary' as BiAggregationMetricKey],
      { reason: 'OKR Dashboard 聚合适配器待接入', mode: 'unavailable' },
    ),
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.RISK_REGISTER,
      ['risk_summary' as BiAggregationMetricKey],
      { reason: '风险登记册聚合适配器待接入', mode: 'unavailable' },
    ),
    new FallbackBiAggregationAdapter(
      BI_AGGREGATION_SOURCE_KEYS.PROJECT_HEALTH_DIAGNOSIS,
      ['project_health_summary' as BiAggregationMetricKey],
      { reason: '项目健康诊断聚合适配器待接入', mode: 'unavailable' },
    ),
  ]
}
