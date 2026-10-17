// apps/backend/app/services/bi_aggregation/source_adapter.ts
// v3-bi-data-aggregation-service §4.1：BI aggregation source adapter 接口与统一 mapper。

import type {
  BiAggregationSourceKey,
  BiAggregationSourceStatus,
  BiAggregationSourceRef,
  BiAggregationFreshness,
  BiAggregationWarning,
  BiAggregationWarningCode,
  BiAggregationMetricKey,
  BiAggregationDimensionKey,
  BiAggregationResultRow,
  BiAggregationSeriesPoint,
  BiAggregationDimensionBucket,
  BiAggregationEvidenceRef,
} from '@aiproj/types'
import {
  BI_AGGREGATION_FRESHNESS_STATES,
  BI_AGGREGATION_SOURCE_STATUSES,
  BI_AGGREGATION_METRIC_VERSION,
  BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS,
} from '@aiproj/types'
import { createHash } from 'node:crypto'

// ─── Source Result ──────────────────────────────────────────────────────

export interface BiAggregationSourceResult {
  sourceKey: BiAggregationSourceKey
  status: BiAggregationSourceStatus
  generatedAt: string
  sourceHash: string
  metricVersion: string
  freshness: BiAggregationFreshness
  warnings: BiAggregationWarning[]
  rows: BiAggregationResultRow[]
  series: BiAggregationSeriesPoint[]
  buckets: BiAggregationDimensionBucket[]
  evidence: BiAggregationEvidenceRef[]
  redactedMetrics: BiAggregationMetricKey[]
  redactedDimensions: BiAggregationDimensionKey[]
}

// ─── Source Adapter Input ──────────────────────────────────────────────

export interface BiAggregationSourceAdapterInput {
  organizationId: number
  userId: number
  metricKeys: BiAggregationMetricKey[]
  dimensions: BiAggregationDimensionKey[]
  window: string
  grain: string
}

// ─── Source Adapter Interface ──────────────────────────────────────────

export interface BiAggregationSourceAdapter {
  /** 适配器唯一 key */
  readonly sourceKey: BiAggregationSourceKey
  /** 该适配器所支持的 metric key 集合 */
  readonly supportedMetricKeys: BiAggregationMetricKey[]
  /** 聚合 */
  aggregate(input: BiAggregationSourceAdapterInput): Promise<BiAggregationSourceResult>
}

// ─── Mapper Helpers ────────────────────────────────────────────────────

/** 计算 sourceHash */
export function computeBiAggregationSourceHash(data: unknown): string {
  const raw = JSON.stringify(data)
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

/** 构建 source ref */
export function makeBiAggregationSourceRef(
  sourceKey: BiAggregationSourceKey,
  status: BiAggregationSourceStatus,
  sourceHash: string,
  freshness: BiAggregationFreshness,
  warnings: BiAggregationWarning[],
): BiAggregationSourceRef {
  return {
    sourceKey,
    status,
    generatedAt: new Date().toISOString(),
    sourceHash,
    metricVersion: BI_AGGREGATION_METRIC_VERSION,
    freshness,
    warnings,
  }
}

/** 创建 fresh 状态的 freshness */
export function makeFreshBiAggregationFreshness(ttlSeconds: number): BiAggregationFreshness {
  return {
    state: BI_AGGREGATION_FRESHNESS_STATES.FRESH,
    generatedAt: new Date().toISOString(),
    ttlSeconds,
    expired: false,
  }
}

/** 创建 stale 状态的 freshness */
export function makeStaleBiAggregationFreshness(
  generatedAt: string,
  ttlSeconds: number,
): BiAggregationFreshness {
  return {
    state: BI_AGGREGATION_FRESHNESS_STATES.STALE,
    generatedAt,
    ttlSeconds,
    expired: true,
  }
}

/** 创建 unavailable 结果 */
export function makeUnavailableSourceResult(
  sourceKey: BiAggregationSourceKey,
  reason: string,
): BiAggregationSourceResult {
  return {
    sourceKey,
    status: BI_AGGREGATION_SOURCE_STATUSES.UNAVAILABLE,
    generatedAt: new Date().toISOString(),
    sourceHash: '',
    metricVersion: BI_AGGREGATION_METRIC_VERSION,
    freshness: {
      state: BI_AGGREGATION_FRESHNESS_STATES.UNAVAILABLE,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 0,
      expired: false,
    },
    warnings: [
      {
        code: 'SOURCE_UNAVAILABLE' as BiAggregationWarningCode,
        level: 'warning',
        message: reason,
        sourceKey,
      },
    ],
    rows: [],
    series: [],
    buckets: [],
    evidence: [],
    redactedMetrics: [],
    redactedDimensions: [],
  }
}

/** 创建 forbidden 结果 */
export function makeForbiddenSourceResult(
  sourceKey: BiAggregationSourceKey,
  reason: string,
): BiAggregationSourceResult {
  return {
    sourceKey,
    status: BI_AGGREGATION_SOURCE_STATUSES.FORBIDDEN,
    generatedAt: new Date().toISOString(),
    sourceHash: '',
    metricVersion: BI_AGGREGATION_METRIC_VERSION,
    freshness: {
      state: BI_AGGREGATION_FRESHNESS_STATES.UNAVAILABLE,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 0,
      expired: false,
    },
    warnings: [
      {
        code: 'SOURCE_FORBIDDEN' as BiAggregationWarningCode,
        level: 'warning',
        message: reason,
        sourceKey,
      },
    ],
    rows: [],
    series: [],
    buckets: [],
    evidence: [],
    redactedMetrics: [],
    redactedDimensions: [],
  }
}

/** 创建 timeout 结果 */
export function makeTimeoutSourceResult(
  sourceKey: BiAggregationSourceKey,
): BiAggregationSourceResult {
  return {
    sourceKey,
    status: BI_AGGREGATION_SOURCE_STATUSES.TIMEOUT,
    generatedAt: new Date().toISOString(),
    sourceHash: '',
    metricVersion: BI_AGGREGATION_METRIC_VERSION,
    freshness: {
      state: BI_AGGREGATION_FRESHNESS_STATES.DEGRADED,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 0,
      expired: false,
    },
    warnings: [
      {
        code: 'SOURCE_TIMEOUT' as BiAggregationWarningCode,
        level: 'warning',
        message: `来源 ${sourceKey} 聚合超时`,
        sourceKey,
      },
    ],
    rows: [],
    series: [],
    buckets: [],
    evidence: [],
    redactedMetrics: [],
    redactedDimensions: [],
  }
}

/** 创建 empty 结果 */
export function makeEmptySourceResult(
  sourceKey: BiAggregationSourceKey,
): BiAggregationSourceResult {
  return {
    sourceKey,
    status: BI_AGGREGATION_SOURCE_STATUSES.EMPTY,
    generatedAt: new Date().toISOString(),
    sourceHash: '',
    metricVersion: BI_AGGREGATION_METRIC_VERSION,
    freshness: makeFreshBiAggregationFreshness(BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS),
    warnings: [],
    rows: [],
    series: [],
    buckets: [],
    evidence: [],
    redactedMetrics: [],
    redactedDimensions: [],
  }
}
