// packages/types/src/bi-data-aggregation-service.test.ts —— 共享契约测试
// 覆盖：key 稳定性、跨端导入、query hash 顺序无关、bounds validation、
// warning merge、freshness merge 和 evidence redaction。

import { describe, it, expect } from 'vitest'
import {
  // 枚举常量
  BI_AGGREGATION_METRIC_KEYS,
  BI_AGGREGATION_DIMENSION_KEYS,
  BI_AGGREGATION_SOURCE_KEYS,
  BI_AGGREGATION_WINDOWS,
  BI_AGGREGATION_GRAINS,
  BI_AGGREGATION_SCOPES,
  BI_AGGREGATION_FILTER_OPERATORS,
  BI_AGGREGATION_COMPARE_MODES,
  BI_AGGREGATION_SORT_KEYS,
  BI_AGGREGATION_FRESHNESS_STATES,
  BI_AGGREGATION_REDACTION_STATES,
  BI_AGGREGATION_WARNING_CODES,
  BI_AGGREGATION_ERROR_CODES,
  BI_AGGREGATION_SOURCE_STATUSES,
  BI_AGGREGATION_UNSUPPORTED_METRIC_KEYS,
  // 变量常量
  BI_AGGREGATION_METRIC_VERSION,
  BI_AGGREGATION_METRIC_KEY_VALUES,
  BI_AGGREGATION_DIMENSION_KEY_VALUES,
  BI_AGGREGATION_SOURCE_KEY_VALUES,
  BI_AGGREGATION_WINDOW_VALUES,
  BI_AGGREGATION_GRAIN_VALUES,
  BI_AGGREGATION_SCOPE_VALUES,
  BI_AGGREGATION_FRESHNESS_STATE_VALUES,
  BI_AGGREGATION_MAX_METRIC_KEYS,
  BI_AGGREGATION_MAX_DIMENSIONS,
  BI_AGGREGATION_MAX_FILTERS,
  BI_AGGREGATION_DEFAULT_PER_PAGE,
  BI_AGGREGATION_MAX_PER_PAGE,
  BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS,
  BI_AGGREGATION_WINDOW_MAX_DAYS,
  // 类型守卫
  isUnsupportedBiAggregationMetricKey,
  isBiAggregationMetricKey,
  isBiAggregationDimensionKey,
  isBiAggregationSourceKey,
  isBiAggregationMetricCountWithinLimit,
  isBiAggregationDimensionCountWithinLimit,
  isBiAggregationFilterCountWithinLimit,
  isBiAggregationPerPageWithinLimit,
  // 纯函数
  normalizeBiAggregationMetricKeys,
  normalizeBiAggregationDimensionKeys,
  buildBiAggregationQueryShape,
  computeBiAggregationQueryHash,
  buildBiAggregationCacheKey,
  mergeBiAggregationFreshness,
  mergeBiAggregationWarnings,
  buildBiAggregationWarning,
  summarizeBiAggregationRedaction,
  redactBiAggregationEvidence,
  makeBiAggregationEvidenceRef,
  isBiAggregationRedacted,
  validateBiAggregationQueryBounds,
  // Fixtures
  makeAuthorizedAggregationFixture,
  makeRedactedAggregationFixture,
  makeStaleAggregationFixture,
  makeCacheDegradedAggregationFixture,
  makeUnsupportedAggregationFixture,
  makeSourceUnavailableAggregationFixture,
  makeLargeOrganizationAggregationFixture,
  makeBiAggregationResponseMeta,
  makeBiAggregationSourceRef,
  // 类型（仅用于编译期验证，不直接测试运行时行为）
  type BiAggregationMetricKey,
  type BiAggregationDimensionKey,
  type BiAggregationSourceKey,
  type BiAggregationWindow,
  type BiAggregationGrain,
  type BiAggregationScope,
  type BiAggregationFilterOperator,
  type BiAggregationCompareMode,
  type BiAggregationSortKey,
  type BiAggregationFreshnessState,
  type BiAggregationRedactionState,
  type BiAggregationWarningCode,
  type BiAggregationSourceStatus,
  type BiAggregationQuery,
  type BiAggregationResult,
  type BiAggregationUnsupportedMetricKey,
} from './bi-data-aggregation-service.js'

// ══════════════════════════════════════════════════════════════════════════
// Key 稳定性
// ══════════════════════════════════════════════════════════════════════════

describe('Key 稳定性', () => {
  it('metric key 枚举值稳定', () => {
    const snapshot = BI_AGGREGATION_METRIC_KEYS
    expect(snapshot.BI_TREND_PROGRESS).toBe('bi_trend_progress')
    expect(snapshot.BI_DASHBOARD_SUMMARY).toBe('bi_dashboard_summary')
    expect(snapshot.PMO_DASHBOARD_SUMMARY).toBe('pmo_dashboard_summary')
    expect(snapshot.RESOURCE_SUMMARY).toBe('resource_summary')
    expect(snapshot.OKR_SUMMARY).toBe('okr_summary')
    expect(snapshot.RISK_SUMMARY).toBe('risk_summary')
    expect(snapshot.PROJECT_HEALTH_SUMMARY).toBe('project_health_summary')
    expect(snapshot.ORGANIZATION_DASHBOARD_SUMMARY).toBe('organization_dashboard_summary')
    expect(snapshot.REPORT_V2_DATASOURCE).toBe('report_v2_datasource')
  })

  it('dimension key 枚举值稳定', () => {
    expect(BI_AGGREGATION_DIMENSION_KEYS.PROJECT).toBe('project')
    expect(BI_AGGREGATION_DIMENSION_KEYS.PORTFOLIO_GROUP).toBe('portfolio_group')
    expect(BI_AGGREGATION_DIMENSION_KEYS.RISK_LEVEL).toBe('risk_level')
    expect(BI_AGGREGATION_DIMENSION_KEYS.HEALTH_STATUS).toBe('health_status')
  })

  it('source key 枚举值稳定', () => {
    expect(BI_AGGREGATION_SOURCE_KEYS.BI_TREND_METRICS).toBe('bi_trend_metrics')
    expect(BI_AGGREGATION_SOURCE_KEYS.PMO_DASHBOARD).toBe('pmo_dashboard')
    expect(BI_AGGREGATION_SOURCE_KEYS.OKR_DASHBOARD).toBe('okr_dashboard')
    expect(BI_AGGREGATION_SOURCE_KEYS.PROJECT_HEALTH_DIAGNOSIS).toBe('project_health_diagnosis')
  })

  it('window 枚举值稳定', () => {
    expect(BI_AGGREGATION_WINDOWS.LAST_30_DAYS).toBe('last_30_days')
    expect(BI_AGGREGATION_WINDOWS.LAST_90_DAYS).toBe('last_90_days')
    expect(BI_AGGREGATION_WINDOWS.CURRENT_YEAR).toBe('current_year')
  })

  it('grain 枚举值稳定', () => {
    expect(BI_AGGREGATION_GRAINS.DAILY).toBe('daily')
    expect(BI_AGGREGATION_GRAINS.WEEKLY).toBe('weekly')
    expect(BI_AGGREGATION_GRAINS.MONTHLY).toBe('monthly')
    expect(BI_AGGREGATION_GRAINS.QUARTERLY).toBe('quarterly')
    expect(BI_AGGREGATION_GRAINS.YEARLY).toBe('yearly')
  })

  it('scope 枚举值稳定', () => {
    expect(BI_AGGREGATION_SCOPES.ORGANIZATION).toBe('organization')
    expect(BI_AGGREGATION_SCOPES.PMO).toBe('pmo')
    expect(BI_AGGREGATION_SCOPES.PROJECT).toBe('project')
  })

  it('warning code 枚举值稳定', () => {
    expect(BI_AGGREGATION_WARNING_CODES.STALE_SOURCE).toBe('STALE_SOURCE')
    expect(BI_AGGREGATION_WARNING_CODES.SOURCE_UNAVAILABLE).toBe('SOURCE_UNAVAILABLE')
    expect(BI_AGGREGATION_WARNING_CODES.SOURCE_FORBIDDEN).toBe('SOURCE_FORBIDDEN')
    expect(BI_AGGREGATION_WARNING_CODES.CACHE_DEGRADED).toBe('CACHE_DEGRADED')
    expect(BI_AGGREGATION_WARNING_CODES.UNSUPPORTED_METRIC).toBe('UNSUPPORTED_METRIC')
    expect(BI_AGGREGATION_WARNING_CODES.INSUFFICIENT_SAMPLE).toBe('INSUFFICIENT_SAMPLE')
    expect(BI_AGGREGATION_WARNING_CODES.MISSING_BUCKET).toBe('MISSING_BUCKET')
    expect(BI_AGGREGATION_WARNING_CODES.PARTIAL_REDACTION).toBe('PARTIAL_REDACTION')
    expect(BI_AGGREGATION_WARNING_CODES.TRUNCATED_RESULT).toBe('TRUNCATED_RESULT')
    expect(BI_AGGREGATION_WARNING_CODES.SOURCE_TIMEOUT).toBe('SOURCE_TIMEOUT')
  })

  it('error code 枚举值稳定', () => {
    expect(BI_AGGREGATION_ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
    expect(BI_AGGREGATION_ERROR_CODES.AUTH_REQUIRED).toBe('AUTH_REQUIRED')
    expect(BI_AGGREGATION_ERROR_CODES.PERMISSION_DENIED).toBe('PERMISSION_DENIED')
    expect(BI_AGGREGATION_ERROR_CODES.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND')
  })

  it('freshness state 枚举值稳定', () => {
    expect(BI_AGGREGATION_FRESHNESS_STATES.FRESH).toBe('fresh')
    expect(BI_AGGREGATION_FRESHNESS_STATES.STALE).toBe('stale')
    expect(BI_AGGREGATION_FRESHNESS_STATES.UNAVAILABLE).toBe('unavailable')
    expect(BI_AGGREGATION_FRESHNESS_STATES.DEGRADED).toBe('degraded')
    expect(BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN).toBe('unknown')
  })

  it('redaction state 枚举值稳定', () => {
    expect(BI_AGGREGATION_REDACTION_STATES.NONE).toBe('none')
    expect(BI_AGGREGATION_REDACTION_STATES.PARTIAL).toBe('partial')
    expect(BI_AGGREGATION_REDACTION_STATES.FULL).toBe('full')
  })

  it('source status 枚举值稳定', () => {
    expect(BI_AGGREGATION_SOURCE_STATUSES.SUCCESS).toBe('success')
    expect(BI_AGGREGATION_SOURCE_STATUSES.FORBIDDEN).toBe('forbidden')
    expect(BI_AGGREGATION_SOURCE_STATUSES.UNAVAILABLE).toBe('unavailable')
    expect(BI_AGGREGATION_SOURCE_STATUSES.TIMEOUT).toBe('timeout')
    expect(BI_AGGREGATION_SOURCE_STATUSES.EMPTY).toBe('empty')
    expect(BI_AGGREGATION_SOURCE_STATUSES.REDACTED).toBe('redacted')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 类型守卫与上限
// ══════════════════════════════════════════════════════════════════════════

describe('类型守卫与上限', () => {
  describe('isUnsupportedBiAggregationMetricKey', () => {
    it('识别财务类不支持指标', () => {
      expect(isUnsupportedBiAggregationMetricKey('budget_cost')).toBe(true)
      expect(isUnsupportedBiAggregationMetricKey('roi')).toBe(true)
      expect(isUnsupportedBiAggregationMetricKey('cash_flow')).toBe(true)
      expect(isUnsupportedBiAggregationMetricKey('revenue')).toBe(true)
      expect(isUnsupportedBiAggregationMetricKey('margin')).toBe(true)
    })

    it('支持指标不判为 unsupported', () => {
      expect(isUnsupportedBiAggregationMetricKey('bi_trend_progress')).toBe(false)
      expect(isUnsupportedBiAggregationMetricKey('okr_summary')).toBe(false)
    })
  })

  describe('isBiAggregationMetricKey', () => {
    it('有效 key 返回 true', () => {
      expect(isBiAggregationMetricKey('bi_trend_progress')).toBe(true)
      expect(isBiAggregationMetricKey('risk_summary')).toBe(true)
    })

    it('无效 key 返回 false', () => {
      expect(isBiAggregationMetricKey('unknown_metric')).toBe(false)
      expect(isBiAggregationMetricKey('')).toBe(false)
    })
  })

  describe('isBiAggregationDimensionKey', () => {
    it('有效 key 返回 true', () => {
      expect(isBiAggregationDimensionKey('project')).toBe(true)
      expect(isBiAggregationDimensionKey('risk_level')).toBe(true)
    })

    it('无效 key 返回 false', () => {
      expect(isBiAggregationDimensionKey('unknown_dim')).toBe(false)
    })
  })

  describe('isBiAggregationSourceKey', () => {
    it('有效 key 返回 true', () => {
      expect(isBiAggregationSourceKey('bi_trend_metrics')).toBe(true)
      expect(isBiAggregationSourceKey('pmo_dashboard')).toBe(true)
    })

    it('无效 key 返回 false', () => {
      expect(isBiAggregationSourceKey('unknown_source')).toBe(false)
    })
  })

  describe('数量上限', () => {
    it('metric 上限', () => {
      expect(
        isBiAggregationMetricCountWithinLimit(Array(BI_AGGREGATION_MAX_METRIC_KEYS).fill('x')),
      ).toBe(true)
      expect(
        isBiAggregationMetricCountWithinLimit(Array(BI_AGGREGATION_MAX_METRIC_KEYS + 1).fill('x')),
      ).toBe(false)
    })

    it('dimension 上限', () => {
      expect(
        isBiAggregationDimensionCountWithinLimit(Array(BI_AGGREGATION_MAX_DIMENSIONS).fill('x')),
      ).toBe(true)
      expect(
        isBiAggregationDimensionCountWithinLimit(
          Array(BI_AGGREGATION_MAX_DIMENSIONS + 1).fill('x'),
        ),
      ).toBe(false)
    })

    it('filter 上限', () => {
      expect(
        isBiAggregationFilterCountWithinLimit(Array(BI_AGGREGATION_MAX_FILTERS).fill({})),
      ).toBe(true)
      expect(
        isBiAggregationFilterCountWithinLimit(Array(BI_AGGREGATION_MAX_FILTERS + 1).fill({})),
      ).toBe(false)
    })

    it('perPage 上限', () => {
      expect(isBiAggregationPerPageWithinLimit(1)).toBe(true)
      expect(isBiAggregationPerPageWithinLimit(BI_AGGREGATION_MAX_PER_PAGE)).toBe(true)
      expect(isBiAggregationPerPageWithinLimit(0)).toBe(false)
      expect(isBiAggregationPerPageWithinLimit(BI_AGGREGATION_MAX_PER_PAGE + 1)).toBe(false)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Query Hash 顺序无关
// ══════════════════════════════════════════════════════════════════════════

describe('Query Hash 稳定性', () => {
  const baseQuery: BiAggregationQuery = {
    scope: 'organization' as BiAggregationScope,
    metricKeys: [
      'bi_trend_progress' as BiAggregationMetricKey,
      'risk_summary' as BiAggregationMetricKey,
    ],
    dimensions: ['project' as BiAggregationDimensionKey],
    window: 'last_30_days' as BiAggregationWindow,
    grain: 'weekly' as BiAggregationGrain,
    compareWith: 'none' as BiAggregationCompareMode,
  }

  it('相同语义 query 生成相同 hash', () => {
    const hash1 = computeBiAggregationQueryHash(baseQuery)
    const hash2 = computeBiAggregationQueryHash({ ...baseQuery })
    expect(hash1).toBe(hash2)
  })

  it('参数顺序不同生成相同 hash', () => {
    const reversed: BiAggregationQuery = {
      ...baseQuery,
      metricKeys: [
        'risk_summary' as BiAggregationMetricKey,
        'bi_trend_progress' as BiAggregationMetricKey,
      ],
    }
    const hash1 = computeBiAggregationQueryHash(baseQuery)
    const hash2 = computeBiAggregationQueryHash(reversed)
    expect(hash1).toBe(hash2)
  })

  it('不同 metric 生成不同 hash', () => {
    const different: BiAggregationQuery = {
      ...baseQuery,
      metricKeys: ['bi_trend_delay' as BiAggregationMetricKey],
    }
    expect(computeBiAggregationQueryHash(baseQuery)).not.toBe(
      computeBiAggregationQueryHash(different),
    )
  })

  it('不同 window 生成不同 hash', () => {
    const different: BiAggregationQuery = {
      ...baseQuery,
      window: 'last_90_days' as BiAggregationWindow,
    }
    expect(computeBiAggregationQueryHash(baseQuery)).not.toBe(
      computeBiAggregationQueryHash(different),
    )
  })

  it('hash 为 8 位 hex 字符串', () => {
    const hash = computeBiAggregationQueryHash(baseQuery)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Cache Key
// ══════════════════════════════════════════════════════════════════════════

describe('Cache Key', () => {
  it('同参数生成相同 cache key', () => {
    const key1 = buildBiAggregationCacheKey(1, 'fp_a', 'hash1', 'perm_a', 'v1')
    const key2 = buildBiAggregationCacheKey(1, 'fp_a', 'hash1', 'perm_a', 'v1')
    expect(key1).toBe(key2)
  })

  it('不同 org 生成不同 cache key', () => {
    const key1 = buildBiAggregationCacheKey(1, 'fp_a', 'hash1', 'perm_a', 'v1')
    const key2 = buildBiAggregationCacheKey(2, 'fp_a', 'hash1', 'perm_a', 'v1')
    expect(key1).not.toBe(key2)
  })

  it('不同权限范围生成不同 cache key', () => {
    const key1 = buildBiAggregationCacheKey(1, 'fp_a', 'hash1', 'perm_a', 'v1')
    const key2 = buildBiAggregationCacheKey(1, 'fp_a', 'hash1', 'perm_b', 'v1')
    expect(key1).not.toBe(key2)
  })

  it('所有 cache key 以 bi:agg 前缀开头', () => {
    const key = buildBiAggregationCacheKey(1, 'fp', 'hash', 'perm', 'v1')
    expect(key.startsWith('bi:agg:')).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Freshness Merge
// ══════════════════════════════════════════════════════════════════════════

describe('Freshness Merge', () => {
  it('空列表返回 unknown', () => {
    expect(mergeBiAggregationFreshness([])).toBe('unknown')
  })

  it('全部 fresh 返回 fresh', () => {
    expect(mergeBiAggregationFreshness(['fresh', 'fresh'])).toBe('fresh')
  })

  it('包含 stale 返回 stale', () => {
    expect(mergeBiAggregationFreshness(['fresh', 'stale'])).toBe('stale')
  })

  it('包含 unavailable 返回 degraded', () => {
    expect(mergeBiAggregationFreshness(['fresh', 'unavailable'])).toBe('degraded')
  })

  it('全部 fresh 优先于 unknown', () => {
    expect(mergeBiAggregationFreshness(['fresh', 'fresh'])).toBe('fresh')
  })

  it('unknown 混 fresh 返回 unknown', () => {
    expect(mergeBiAggregationFreshness(['fresh', 'unknown'])).toBe('unknown')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Warning Merge
// ══════════════════════════════════════════════════════════════════════════

describe('Warning Merge', () => {
  it('去重相同 code+source', () => {
    const w1 = buildBiAggregationWarning(
      'STALE_SOURCE' as BiAggregationWarningCode,
      'warning',
      'msg1',
      'pmo_dashboard' as BiAggregationSourceKey,
    )
    const w2 = buildBiAggregationWarning(
      'STALE_SOURCE' as BiAggregationWarningCode,
      'warning',
      'msg2',
      'pmo_dashboard' as BiAggregationSourceKey,
    )
    const merged = mergeBiAggregationWarnings([w1, w2])
    expect(merged.length).toBe(1)
  })

  it('不同 code 保留', () => {
    const w1 = buildBiAggregationWarning(
      'STALE_SOURCE' as BiAggregationWarningCode,
      'warning',
      'msg1',
    )
    const w2 = buildBiAggregationWarning(
      'SOURCE_UNAVAILABLE' as BiAggregationWarningCode,
      'warning',
      'msg2',
    )
    const merged = mergeBiAggregationWarnings([w1, w2])
    expect(merged.length).toBe(2)
  })

  it('相同 code 不同 source 保留', () => {
    const w1 = buildBiAggregationWarning(
      'STALE_SOURCE' as BiAggregationWarningCode,
      'warning',
      'msg1',
      'pmo_dashboard' as BiAggregationSourceKey,
    )
    const w2 = buildBiAggregationWarning(
      'STALE_SOURCE' as BiAggregationWarningCode,
      'warning',
      'msg2',
      'okr_dashboard' as BiAggregationSourceKey,
    )
    const merged = mergeBiAggregationWarnings([w1, w2])
    expect(merged.length).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Redaction Summary
// ══════════════════════════════════════════════════════════════════════════

describe('Redaction Summary', () => {
  it('无 redacted 返回 none', () => {
    expect(summarizeBiAggregationRedaction([], [], 5, 3)).toBe('none')
  })

  it('部分 redacted 返回 partial', () => {
    expect(summarizeBiAggregationRedaction(['a'], [], 3, 3)).toBe('partial')
  })

  it('全部 dimensions redacted 返回 full', () => {
    expect(summarizeBiAggregationRedaction(['a', 'b'], [], 2, 3)).toBe('full')
  })

  it('全部 sources redacted 返回 full', () => {
    expect(summarizeBiAggregationRedaction([], ['s1', 's2', 's3'], 5, 3)).toBe('full')
  })

  it('isBiAggregationRedacted: none 为 false', () => {
    expect(isBiAggregationRedacted('none')).toBe(false)
  })

  it('isBiAggregationRedacted: partial/full 为 true', () => {
    expect(isBiAggregationRedacted('partial')).toBe(true)
    expect(isBiAggregationRedacted('full')).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Evidence Redaction
// ══════════════════════════════════════════════════════════════════════════

describe('Evidence Redaction', () => {
  it('authorized ref 保留 refId', () => {
    const ref = makeBiAggregationEvidenceRef(
      'bi_trend_metrics' as BiAggregationSourceKey,
      'bi_trend_progress' as BiAggregationMetricKey,
      { state: 'fresh', generatedAt: new Date().toISOString(), ttlSeconds: 300, expired: false },
      'project',
      'proj_123',
      true,
    )
    const redacted = redactBiAggregationEvidence([ref])
    expect(redacted[0].refId).toBe('proj_123')
  })

  it('unauthorized ref 脱敏 refId', () => {
    const ref = makeBiAggregationEvidenceRef(
      'okr_dashboard' as BiAggregationSourceKey,
      'okr_summary' as BiAggregationMetricKey,
      { state: 'fresh', generatedAt: new Date().toISOString(), ttlSeconds: 300, expired: false },
      'okr',
      'okr_secret_123',
      false,
    )
    const redacted = redactBiAggregationEvidence([ref])
    expect(redacted[0].refId).toBe('')
    expect(redacted[0].authorized).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Normalize Keys
// ══════════════════════════════════════════════════════════════════════════

describe('Key Normalization', () => {
  it('normalize metric keys 去重排序', () => {
    const keys: BiAggregationMetricKey[] = [
      'risk_summary' as BiAggregationMetricKey,
      'bi_trend_progress' as BiAggregationMetricKey,
      'risk_summary' as BiAggregationMetricKey,
    ]
    const normalized = normalizeBiAggregationMetricKeys(keys)
    expect(normalized).toEqual(['bi_trend_progress', 'risk_summary'])
  })

  it('normalize dimension keys 去重排序', () => {
    const keys: BiAggregationDimensionKey[] = [
      'project' as BiAggregationDimensionKey,
      'risk_level' as BiAggregationDimensionKey,
      'project' as BiAggregationDimensionKey,
    ]
    const normalized = normalizeBiAggregationDimensionKeys(keys)
    expect(normalized).toEqual(['project', 'risk_level'])
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Query Shape
// ══════════════════════════════════════════════════════════════════════════

describe('Query Shape', () => {
  it('构建确定性的 query shape', () => {
    const query: BiAggregationQuery = {
      scope: 'organization' as BiAggregationScope,
      metricKeys: [
        'risk_summary' as BiAggregationMetricKey,
        'bi_trend_progress' as BiAggregationMetricKey,
      ],
      dimensions: ['project' as BiAggregationDimensionKey],
      window: 'last_90_days' as BiAggregationWindow,
      grain: 'monthly' as BiAggregationGrain,
      compareWith: 'previous_period' as BiAggregationCompareMode,
    }
    const shape = buildBiAggregationQueryShape(query)
    expect(shape.metricKeys).toEqual(['bi_trend_progress', 'risk_summary'])
    expect(shape.window).toBe('last_90_days')
    expect(shape.grain).toBe('monthly')
    expect(shape.compareWith).toBe('previous_period')
  })

  it('默认值填充', () => {
    const shape = buildBiAggregationQueryShape({
      scope: 'organization' as BiAggregationScope,
      metricKeys: ['bi_trend_progress' as BiAggregationMetricKey],
    })
    expect(shape.window).toBe('last_30_days')
    expect(shape.grain).toBe('weekly')
    expect(shape.compareWith).toBe('none')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Bounds Validation
// ══════════════════════════════════════════════════════════════════════════

describe('Bounds Validation', () => {
  it('合法 query 通过', () => {
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: ['bi_trend_progress' as BiAggregationMetricKey],
    })
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('空 metricKeys 失败', () => {
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: [],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('不能为空'))).toBe(true)
  })

  it('超限 metricKeys 失败', () => {
    const keys = Array(BI_AGGREGATION_MAX_METRIC_KEYS + 1).fill(
      'bi_trend_progress' as BiAggregationMetricKey,
    )
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: keys,
    })
    expect(result.valid).toBe(false)
  })

  it('财务 unsupported metric 被识别', () => {
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: ['budget_cost' as unknown as BiAggregationMetricKey],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('budget_cost'))).toBe(true)
  })

  it('超限 perPage 失败', () => {
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: ['bi_trend_progress' as BiAggregationMetricKey],
      perPage: 9999,
    })
    expect(result.valid).toBe(false)
  })

  it('between filter 缺 valueEnd 失败', () => {
    const result = validateBiAggregationQueryBounds({
      scope: 'organization' as BiAggregationScope,
      metricKeys: ['bi_trend_progress' as BiAggregationMetricKey],
      filters: [
        {
          dimension: 'project' as BiAggregationDimensionKey,
          operator: 'between' as BiAggregationFilterOperator,
          value: 1,
        },
      ],
    })
    expect(result.valid).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════════════════

describe('Fixtures', () => {
  it('makeAuthorizedAggregationFixture 产合法结果', () => {
    const fixture = makeAuthorizedAggregationFixture()
    expect(fixture.rows.length).toBeGreaterThan(0)
    expect(fixture.series.length).toBeGreaterThan(0)
    expect(fixture.provenance.redaction.state).toBe('none')
    expect(fixture.warnings).toHaveLength(0)
  })

  it('makeRedactedAggregationFixture 带 partial redaction', () => {
    const fixture = makeRedactedAggregationFixture()
    expect(fixture.provenance.redaction.state).toBe('partial')
    expect(fixture.warnings.length).toBeGreaterThan(0)
  })

  it('makeStaleAggregationFixture 带 stale warning', () => {
    const fixture = makeStaleAggregationFixture()
    expect(fixture.provenance.sourceRefs.some((r) => r.freshness.state === 'stale')).toBe(true)
  })

  it('makeCacheDegradedAggregationFixture 带 degraded', () => {
    const fixture = makeCacheDegradedAggregationFixture()
    expect(fixture.cache.degraded).toBe(true)
    expect(fixture.warnings.some((w) => w.code === 'CACHE_DEGRADED')).toBe(true)
  })

  it('makeUnsupportedAggregationFixture 返回空数据', () => {
    const fixture = makeUnsupportedAggregationFixture()
    expect(fixture.rows).toHaveLength(0)
    expect(fixture.warnings.some((w) => w.code === 'UNSUPPORTED_METRIC')).toBe(true)
  })

  it('makeSourceUnavailableAggregationFixture 带 unavailable', () => {
    const fixture = makeSourceUnavailableAggregationFixture()
    expect(fixture.provenance.sourceRefs.some((r) => r.status === 'unavailable')).toBe(true)
  })

  it('makeLargeOrganizationAggregationFixture 生成 1000 行', () => {
    const fixture = makeLargeOrganizationAggregationFixture(1000)
    expect(fixture.rows.length).toBe(1000)
    expect(fixture.series.length).toBe(1000)
    expect(fixture.dimensionBuckets.length).toBe(1000)
  })

  it('makeBiAggregationResponseMeta 生成合法 meta', () => {
    const meta = makeBiAggregationResponseMeta()
    expect(meta.total).toBe(100)
    expect(meta.page).toBe(1)
    expect(meta.perPage).toBe(BI_AGGREGATION_DEFAULT_PER_PAGE)
    expect(meta.redactionState).toBe('none')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 版本常量
// ══════════════════════════════════════════════════════════════════════════

describe('版本常量', () => {
  it('BI_AGGREGATION_METRIC_VERSION 稳定', () => {
    expect(BI_AGGREGATION_METRIC_VERSION).toBe('bi-aggregation-v1')
  })

  it('CACHE_DEFAULT_TTL 为 300 秒', () => {
    expect(BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS).toBe(300)
  })

  it('WINDOW_MAX_DAYS 为 730', () => {
    expect(BI_AGGREGATION_WINDOW_MAX_DAYS).toBe(730)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 值数组完整性
// ══════════════════════════════════════════════════════════════════════════

describe('值数组完整性', () => {
  it('METRIC_KEY_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_METRIC_KEY_VALUES.length).toBe(
      Object.keys(BI_AGGREGATION_METRIC_KEYS).length,
    )
  })

  it('DIMENSION_KEY_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_DIMENSION_KEY_VALUES.length).toBe(
      Object.keys(BI_AGGREGATION_DIMENSION_KEYS).length,
    )
  })

  it('SOURCE_KEY_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_SOURCE_KEY_VALUES.length).toBe(
      Object.keys(BI_AGGREGATION_SOURCE_KEYS).length,
    )
  })

  it('WINDOW_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_WINDOW_VALUES.length).toBe(Object.keys(BI_AGGREGATION_WINDOWS).length)
  })

  it('GRAIN_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_GRAIN_VALUES.length).toBe(Object.keys(BI_AGGREGATION_GRAINS).length)
  })

  it('SCOPE_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_SCOPE_VALUES.length).toBe(Object.keys(BI_AGGREGATION_SCOPES).length)
  })

  it('FRESHNESS_STATE_VALUES 覆盖所有 key', () => {
    expect(BI_AGGREGATION_FRESHNESS_STATE_VALUES.length).toBe(
      Object.keys(BI_AGGREGATION_FRESHNESS_STATES).length,
    )
  })
})
