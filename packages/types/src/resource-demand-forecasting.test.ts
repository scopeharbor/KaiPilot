// @aiproj/types —— 资源需求预测共享契约测试（前后端共享）。
// v3-resource-demand-forecasting §2.4：DTO 形状、枚举守卫、warning 语义、helper 确定性、需求/分配分离、脱敏状态。
import { describe, it, expect } from 'vitest'
import {
  FORECAST_METHODS,
  FORECAST_METHOD_VALUES,
  FORECAST_GRANULARITIES,
  FORECAST_GRANULARITY_VALUES,
  FORECAST_MAX_WINDOW_WEEKS,
  FORECAST_MIN_WINDOW_WEEKS,
  FORECAST_CONFIDENCE_BANDS,
  FORECAST_CONFIDENCE_BAND_VALUES,
  FORECAST_WARNING_CODES,
  FORECAST_WARNING_CODE_VALUES,
  FORECAST_REDACTION_STATES,
  FORECAST_LOAD_STATUSES,
  FORECAST_LOAD_STATUS_VALUES,
  FORECAST_GAP_TYPES,
  FORECAST_SORT_KEYS,
  FORECAST_SORT_KEY_VALUES,
  FORECAST_SOURCE_KEYS,
  RESOURCE_DEMAND_FORECASTING_METRIC_KEYS,
  RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES,
  isForecastWarningCode,
  normalizeForecastWarnings,
  rankForecastWarningSeverity,
  normalizeDateToBucket,
  computeBucketEnd,
  computeConfidenceBand,
  isForecastDemandDistinct,
  computeEvidenceHash,
  computeForecastFreshnessHash,
  mergeForecastFreshness,
  makeEmptyForecastFreshness,
  validateForecastQuery,
  isForecastGranularity,
  isForecastConfidenceBand,
} from './resource-demand-forecasting.js'

// ─── Enum Guards ─────────────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Enum Guards', () => {
  it('forecast methods are non-empty and unique', () => {
    expect(FORECAST_METHOD_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_METHOD_VALUES).size).toBe(FORECAST_METHOD_VALUES.length)
  })

  it('granularity values are non-empty and unique', () => {
    expect(FORECAST_GRANULARITY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_GRANULARITY_VALUES).size).toBe(FORECAST_GRANULARITY_VALUES.length)
  })

  it('confidence band values are non-empty and unique', () => {
    expect(FORECAST_CONFIDENCE_BAND_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_CONFIDENCE_BAND_VALUES).size).toBe(
      FORECAST_CONFIDENCE_BAND_VALUES.length,
    )
  })

  it('warning code values are non-empty and unique', () => {
    expect(FORECAST_WARNING_CODE_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_WARNING_CODE_VALUES).size).toBe(FORECAST_WARNING_CODE_VALUES.length)
  })

  it('load status values are non-empty and unique', () => {
    expect(FORECAST_LOAD_STATUS_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_LOAD_STATUS_VALUES).size).toBe(FORECAST_LOAD_STATUS_VALUES.length)
  })

  it('sort key values are non-empty and unique', () => {
    expect(FORECAST_SORT_KEY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(FORECAST_SORT_KEY_VALUES).size).toBe(FORECAST_SORT_KEY_VALUES.length)
  })

  it('metric key values are non-empty and unique', () => {
    expect(RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES).size).toBe(
      RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES.length,
    )
  })

  it('FORECAST_METHODS keys match values length', () => {
    expect(Object.keys(FORECAST_METHODS).length).toBe(FORECAST_METHOD_VALUES.length)
  })

  it('FORECAST_GRANULARITIES keys match values length', () => {
    expect(Object.keys(FORECAST_GRANULARITIES).length).toBe(FORECAST_GRANULARITY_VALUES.length)
  })

  it('FORECAST_CONFIDENCE_BANDS keys match values length', () => {
    expect(Object.keys(FORECAST_CONFIDENCE_BANDS).length).toBe(
      FORECAST_CONFIDENCE_BAND_VALUES.length,
    )
  })

  it('FORECAST_WARNING_CODES keys match values length', () => {
    expect(Object.keys(FORECAST_WARNING_CODES).length).toBe(FORECAST_WARNING_CODE_VALUES.length)
  })

  it('FORECAST_SORT_KEYS keys match values length', () => {
    expect(Object.keys(FORECAST_SORT_KEYS).length).toBe(FORECAST_SORT_KEY_VALUES.length)
  })

  it('RESOURCE_DEMAND_FORECASTING_METRIC_KEYS keys match values length', () => {
    expect(Object.keys(RESOURCE_DEMAND_FORECASTING_METRIC_KEYS).length).toBe(
      RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES.length,
    )
  })
})

// ─── Warning Code Guards ────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Warning Code Guards', () => {
  it('isForecastWarningCode returns true for valid codes', () => {
    expect(isForecastWarningCode('INSUFFICIENT_HISTORY')).toBe(true)
    expect(isForecastWarningCode('STALE_SOURCE')).toBe(true)
    expect(isForecastWarningCode('PARTIAL_VISIBILITY')).toBe(true)
    expect(isForecastWarningCode('CACHE_DEGRADED')).toBe(true)
    expect(isForecastWarningCode('AI_UNAVAILABLE')).toBe(true)
    expect(isForecastWarningCode('FEATURE_DISABLED')).toBe(true)
    expect(isForecastWarningCode('DIMENSION_REDACTED')).toBe(true)
    expect(isForecastWarningCode('LOW_CONFIDENCE')).toBe(true)
    expect(isForecastWarningCode('EXCEEDS_MAX_WINDOW')).toBe(true)
    expect(isForecastWarningCode('NO_PROJECTS_VISIBLE')).toBe(true)
  })

  it('isForecastWarningCode returns false for invalid codes', () => {
    expect(isForecastWarningCode('INVALID_CODE')).toBe(false)
    expect(isForecastWarningCode('')).toBe(false)
    expect(isForecastWarningCode(undefined)).toBe(false)
    expect(isForecastWarningCode(null)).toBe(false)
    expect(isForecastWarningCode(123)).toBe(false)
  })

  it('normalizeForecastWarnings deduplicates and sorts', () => {
    const input = ['STALE_SOURCE', 'LOW_CONFIDENCE', 'STALE_SOURCE', 'AI_UNAVAILABLE'] as const
    const result = normalizeForecastWarnings([...input])
    expect(result.length).toBe(3)
    // sorted alphabetically
    expect(result[0]).toBe('AI_UNAVAILABLE')
    expect(result[1]).toBe('LOW_CONFIDENCE')
    expect(result[2]).toBe('STALE_SOURCE')
  })

  it('rankForecastWarningSeverity orders by severity', () => {
    const input = ['LOW_CONFIDENCE', 'FEATURE_DISABLED', 'STALE_SOURCE'] as const
    const result = rankForecastWarningSeverity([...input])
    // FEATURE_DISABLED=0, STALE_SOURCE=1, LOW_CONFIDENCE=3
    expect(result[0]).toBe('FEATURE_DISABLED')
    expect(result[1]).toBe('STALE_SOURCE')
    expect(result[2]).toBe('LOW_CONFIDENCE')
  })
})

// ─── Date Bucket Normalization ──────────────────────────────────────────────

describe('Resource Demand Forecasting — Date Bucket Normalization', () => {
  it('normalizeDateToBucket: day returns YYYY-MM-DD', () => {
    const result = normalizeDateToBucket('2026-07-15T12:00:00Z', 'day')
    expect(result).toBe('2026-07-15')
  })

  it('normalizeDateToBucket: week normalizes to Monday', () => {
    // 2026-07-15 is a Wednesday; Monday would be 2026-07-13
    const result = normalizeDateToBucket('2026-07-15', 'week')
    expect(result).toBe('2026-07-13')
  })

  it('normalizeDateToBucket: month normalizes to first day', () => {
    const result = normalizeDateToBucket('2026-07-15', 'month')
    expect(result).toBe('2026-07-01')
  })

  it('normalizeDateToBucket: returns input on invalid date', () => {
    const result = normalizeDateToBucket('not-a-date', 'day')
    expect(result).toBe('not-a-date')
  })

  it('computeBucketEnd: day adds one day', () => {
    const result = computeBucketEnd('2026-07-15', 'day')
    expect(result).toBe('2026-07-16')
  })

  it('computeBucketEnd: week adds 7 days', () => {
    const result = computeBucketEnd('2026-07-13', 'week')
    expect(result).toBe('2026-07-20')
  })

  it('computeBucketEnd: month adds one month', () => {
    const result = computeBucketEnd('2026-07-01', 'month')
    expect(result).toBe('2026-08-01')
  })
})

// ─── Confidence Band Computation ────────────────────────────────────────────

describe('Resource Demand Forecasting — Confidence Band Computation', () => {
  it('returns UNKNOWN when no projects visible', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 30,
      sourceFreshnessDays: 1,
      sourceCoverage: 0.9,
      visibleProjectCount: 0,
    })
    expect(result).toBe('unknown')
  })

  it('returns UNKNOWN when source coverage is zero', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 30,
      sourceFreshnessDays: 1,
      sourceCoverage: 0,
      visibleProjectCount: 5,
    })
    expect(result).toBe('unknown')
  })

  it('returns HIGH for excellent inputs', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 30,
      sourceFreshnessDays: 0,
      sourceCoverage: 0.9,
      visibleProjectCount: 10,
    })
    expect(result).toBe('high')
  })

  it('returns MEDIUM for moderate inputs', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 15,
      sourceFreshnessDays: 5,
      sourceCoverage: 0.6,
      visibleProjectCount: 5,
    })
    expect(result).toBe('medium')
  })

  it('returns LOW for weak inputs', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 3,
      sourceFreshnessDays: 20,
      sourceCoverage: 0.4,
      visibleProjectCount: 2,
    })
    expect(result).toBe('low')
  })

  it('handles null source freshness', () => {
    const result = computeConfidenceBand({
      historicalDataPoints: 5,
      sourceFreshnessDays: null,
      sourceCoverage: 0.5,
      visibleProjectCount: 3,
    })
    expect(result).toBe('low')
  })
})

// ─── Demand / Allocation Separation ─────────────────────────────────────────

describe('Resource Demand Forecasting — Demand/Allocation Separation', () => {
  it('isForecastDemandDistinct always returns true (type safety)', () => {
    expect(isForecastDemandDistinct(100, 50)).toBe(true)
    expect(isForecastDemandDistinct(0, 0)).toBe(true)
    expect(isForecastDemandDistinct(100, 100)).toBe(true)
  })
})

// ─── Evidence Hash ──────────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Evidence Hash', () => {
  it('computeEvidenceHash is deterministic', () => {
    const a = computeEvidenceHash('test-input')
    const b = computeEvidenceHash('test-input')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })

  it('computeEvidenceHash produces different output for different input', () => {
    const a = computeEvidenceHash('input-a')
    const b = computeEvidenceHash('input-b')
    expect(a).not.toBe(b)
  })

  it('computeForecastFreshnessHash is deterministic', () => {
    const sources = { project_plans: '2026-07-01T00:00:00Z', resource_registry: null }
    const a = computeForecastFreshnessHash(sources)
    const b = computeForecastFreshnessHash(sources)
    expect(a).toBe(b)
  })
})

// ─── Freshness Merging ──────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Freshness Merging', () => {
  it('makeEmptyForecastFreshness returns all null sources', () => {
    const f = makeEmptyForecastFreshness()
    expect(f.isStale).toBe(true)
    expect(f.sourceCoverage).toBe(0)
    expect(f.overallFreshness).toBeNull()
    for (const key of Object.values(FORECAST_SOURCE_KEYS)) {
      expect(f.sources[key]).toBeNull()
    }
  })

  it('mergeForecastFreshness merges timestamps correctly', () => {
    const a = makeEmptyForecastFreshness()
    a.sources.project_plans = '2026-07-01T00:00:00Z'
    a.sources.resource_registry = '2026-07-02T00:00:00Z'
    a.isStale = false

    const b = makeEmptyForecastFreshness()
    b.sources.project_plans = '2026-07-05T00:00:00Z'
    b.sources.resource_allocations = '2026-07-03T00:00:00Z'

    const merged = mergeForecastFreshness(a, b)
    // b has later project_plans
    expect(merged.sources.project_plans).toBe('2026-07-05T00:00:00Z')
    expect(merged.sources.resource_registry).toBe('2026-07-02T00:00:00Z')
    expect(merged.sources.resource_allocations).toBe('2026-07-03T00:00:00Z')
  })
})

// ─── Query Validation ───────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Query Validation', () => {
  it('validates a valid query', () => {
    const result = validateForecastQuery({
      startDate: '2026-07-01',
      endDate: '2026-08-01',
      granularity: 'week',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects missing startDate', () => {
    const result = validateForecastQuery({
      startDate: '',
      endDate: '2026-08-01',
      granularity: 'week',
    } as any)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('startDate'))).toBe(true)
  })

  it('rejects invalid granularity', () => {
    const result = validateForecastQuery({
      startDate: '2026-07-01',
      endDate: '2026-08-01',
      granularity: 'hour' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('granularity'))).toBe(true)
  })

  it('rejects endDate before startDate', () => {
    const result = validateForecastQuery({
      startDate: '2026-08-01',
      endDate: '2026-07-01',
      granularity: 'week',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('endDate'))).toBe(true)
  })

  it('rejects window exceeding max', () => {
    const result = validateForecastQuery({
      startDate: '2026-01-01',
      endDate: '2026-06-01',
      granularity: 'week',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('预测窗口不得超过'))).toBe(true)
  })

  it('rejects window below min', () => {
    const result = validateForecastQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      granularity: 'week',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('预测窗口不得少于'))).toBe(true)
  })

  it('rejects invalid perPage', () => {
    const result = validateForecastQuery({
      startDate: '2026-07-01',
      endDate: '2026-08-01',
      granularity: 'week',
      perPage: 1000,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('perPage'))).toBe(true)
  })

  it('rejects invalid topN', () => {
    const result = validateForecastQuery({
      startDate: '2026-07-01',
      endDate: '2026-08-01',
      granularity: 'week',
      topN: 600,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('topN'))).toBe(true)
  })
})

// ─── Type Guards ────────────────────────────────────────────────────────────

describe('Resource Demand Forecasting — Type Guards', () => {
  it('isForecastGranularity validates correctly', () => {
    expect(isForecastGranularity('day')).toBe(true)
    expect(isForecastGranularity('week')).toBe(true)
    expect(isForecastGranularity('month')).toBe(true)
    expect(isForecastGranularity('hour')).toBe(false)
    expect(isForecastGranularity(undefined)).toBe(false)
  })

  it('isForecastConfidenceBand validates correctly', () => {
    expect(isForecastConfidenceBand('high')).toBe(true)
    expect(isForecastConfidenceBand('medium')).toBe(true)
    expect(isForecastConfidenceBand('low')).toBe(true)
    expect(isForecastConfidenceBand('unknown')).toBe(true)
    expect(isForecastConfidenceBand('extreme')).toBe(false)
    expect(isForecastConfidenceBand(undefined)).toBe(false)
  })
})
